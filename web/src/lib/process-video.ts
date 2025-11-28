/**
 * Video processing logic
 * Separate module so it can be imported by both API routes and Server Actions
 *
 * Uses AdaptiveRateLimiter with dual-track sliding window:
 * - Estimates (from countTokens or formula) for admission control
 * - Actuals (from usageMetadata) to update window state
 *
 * Failure handling uses circuit breaker pattern:
 * - 3 consecutive failures = fail job (sustained issue)
 * - 5 total failures = fail job (too unstable)
 */

import { randomInt } from 'node:crypto';
import PQueue from 'p-queue';

import type { ChunkAnalysis } from '@/types';

import { FAILURE_CONFIG, QUEUE_CONFIG, RATE_LIMIT_CONFIG } from './constants';
import {
  analyzeChunk,
  consolidateChunks,
  countChunkTokens,
  countConsolidationTokens,
} from './gemini';
import {
  addLog,
  addTokensUsed,
  getJob,
  setError,
  setResult,
  updateChunkStatus,
  updateJobStatus,
} from './jobs';
import { logger } from './logger';
import { getPromptPairOrDefault } from './prompts/registry';
import { AdaptiveRateLimiter, getRateLimits } from './rate-limits';
import { calculateTokens } from './utils';

/**
 * Job failure tracker
 * Implements circuit breaker pattern for API health
 */
class FailureTracker {
  private consecutiveFailures = 0;
  private totalFailures = 0;
  private readonly jobId: string;

  constructor(jobId: string) {
    this.jobId = jobId;
  }

  /**
   * Record a successful task completion
   * Resets consecutive failure counter
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * Record a task failure
   * @returns true if job should continue, false if thresholds exceeded
   */
  recordFailure(taskName: string, error: Error): boolean {
    this.consecutiveFailures++;
    this.totalFailures++;

    logger.warn('FailureTracker', 'Task failed', {
      jobId: this.jobId,
      taskName,
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      maxConsecutive: FAILURE_CONFIG.maxConsecutiveFailures,
      maxTotal: FAILURE_CONFIG.maxTotalFailures,
      error: error.message.slice(0, 200),
    });

    addLog(
      this.jobId,
      'warn',
      `${taskName} failed (${this.consecutiveFailures} consecutive, ${this.totalFailures} total)`
    );

    // Check thresholds
    if (this.consecutiveFailures >= FAILURE_CONFIG.maxConsecutiveFailures) {
      logger.error('FailureTracker', 'Consecutive failure threshold exceeded', {
        jobId: this.jobId,
        consecutiveFailures: this.consecutiveFailures,
        threshold: FAILURE_CONFIG.maxConsecutiveFailures,
      });
      return false;
    }

    if (this.totalFailures >= FAILURE_CONFIG.maxTotalFailures) {
      logger.error('FailureTracker', 'Total failure threshold exceeded', {
        jobId: this.jobId,
        totalFailures: this.totalFailures,
        threshold: FAILURE_CONFIG.maxTotalFailures,
      });
      return false;
    }

    return true;
  }

  /**
   * Get failure reason for error message
   */
  getFailureReason(): string {
    if (this.consecutiveFailures >= FAILURE_CONFIG.maxConsecutiveFailures) {
      return `${this.consecutiveFailures} consecutive failures - API may be unavailable`;
    }
    if (this.totalFailures >= FAILURE_CONFIG.maxTotalFailures) {
      return `${this.totalFailures} total failures - too many errors`;
    }
    return 'Unknown failure';
  }

  /**
   * Check if job should be aborted
   */
  shouldAbort(): boolean {
    return (
      this.consecutiveFailures >= FAILURE_CONFIG.maxConsecutiveFailures ||
      this.totalFailures >= FAILURE_CONFIG.maxTotalFailures
    );
  }

  getStats() {
    return {
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
    };
  }
}

/**
 * Extract retry delay from Gemini error message
 * Gemini returns "retry in XX.XXs" in error messages
 */
function extractRetryDelay(error: Error): number {
  const regex = /retry in ([\d.]+)s/i;
  const match = regex.exec(error.message);
  if (match?.[1]) {
    return Math.ceil(Number.parseFloat(match[1]) * 1000);
  }
  return 0;
}

/**
 * Calculate backoff delay for retries
 */
function calculateBackoff(attempt: number, error?: Error): number {
  // First, try to use Gemini's suggested retry delay
  if (error) {
    const geminiDelay = extractRetryDelay(error);
    if (geminiDelay > 0) {
      return Math.min(geminiDelay, FAILURE_CONFIG.maxRetryDelayMs);
    }
  }

  // Fall back to exponential backoff
  const exponentialDelay =
    FAILURE_CONFIG.baseRetryDelayMs * Math.pow(FAILURE_CONFIG.backoffMultiplier, attempt);

  // Add jitter (0-10% of delay) to prevent thundering herd
  // Using crypto.randomInt for SonarQube compliance (not security-critical)
  const jitter = (randomInt(1000) / 1000) * exponentialDelay * 0.1;

  return Math.min(exponentialDelay + jitter, FAILURE_CONFIG.maxRetryDelayMs);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a task with retry on failure
 * Uses global failure tracker for circuit breaker
 */
async function executeWithRetry<T>(
  taskName: string,
  task: () => Promise<T>,
  failureTracker: FailureTracker,
  onRetry?: (attempt: number) => void
): Promise<T> {
  let lastError: Error | undefined;
  let attempt = 0;

  while (!failureTracker.shouldAbort()) {
    try {
      const result = await task();
      failureTracker.recordSuccess();
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;

      // Record failure and check if we should continue
      const shouldContinue = failureTracker.recordFailure(taskName, lastError);

      if (!shouldContinue) {
        // Thresholds exceeded, abort
        break;
      }

      // Calculate retry delay
      const delayMs = calculateBackoff(attempt, lastError);

      logger.info('ProcessVideo', `${taskName} will retry`, {
        attempt,
        delayMs: Math.round(delayMs),
      });

      onRetry?.(attempt);

      // Wait before retry
      await sleep(delayMs);
    }
  }

  // If we get here, either thresholds were exceeded or we ran out of retries
  throw lastError || new Error(`${taskName} failed: ${failureTracker.getFailureReason()}`);
}

/**
 * Background processing function
 * Processes all video chunks and consolidates results
 */
export async function processVideoInBackground(jobId: string, apiKey: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) {
    logger.error('ProcessVideo', 'Job not found', { jobId });
    return;
  }

  // Get prompt pair (uses default if not specified or not found)
  const promptPair = getPromptPairOrDefault(job.config.promptId);

  logger.info('ProcessVideo', 'Starting job processing', {
    jobId,
    chunkCount: job.chunks.length,
    resolution: job.config.resolution,
    fps: job.config.fps,
    chunkSizeMinutes: job.config.chunkSize,
    promptId: promptPair.id,
  });

  // Create failure tracker for this job
  const failureTracker = new FailureTracker(jobId);

  try {
    updateJobStatus(jobId, 'processing');

    // Get rate limits for model and tier
    const limits = getRateLimits(job.config.model, job.config.tier);
    logger.info('ProcessVideo', 'Using rate limits', {
      jobId,
      model: job.config.model,
      tier: job.config.tier,
      rpm: limits.rpm,
      tpm: limits.tpm,
    });

    // Create adaptive rate limiter with dual-track sliding window
    const rateLimiter = new AdaptiveRateLimiter({
      tpm: limits.tpm,
      rpm: limits.rpm,
      initialSafetyMultiplier: RATE_LIMIT_CONFIG.initialSafetyMultiplier,
      bufferPercent: RATE_LIMIT_CONFIG.limitBufferPercent,
    });

    // Create processing queue with concurrency limit
    const queue = new PQueue({
      concurrency: QUEUE_CONFIG.maxConcurrent,
    });

    // Track successful chunk results
    const chunkResults: ChunkAnalysis[] = [];
    let aborted = false;

    // Process all chunks with rate limiting and failure tracking
    const chunkPromises = job.chunks.map((chunk) =>
      queue.add(async () => {
        // Check if job was aborted due to failures
        if (aborted || failureTracker.shouldAbort()) {
          throw new Error('Job aborted due to too many failures');
        }

        const chunkLabel = `Chunk ${chunk.id + 1}`;

        const result = await executeWithRetry(
          chunkLabel,
          async () => {
            const requestId = rateLimiter.generateRequestId();
            const startTime = Date.now();

            // Step 1: Get token estimate
            const chunkOptions = {
              apiKey,
              videoUrl: job.config.videoUrl,
              startOffset: chunk.startOffset,
              endOffset: chunk.endOffset,
              prompt: promptPair.chunkAnalysis,
              fps: job.config.fps,
              resolution: job.config.resolution,
              model: job.config.model,
            };

            let estimatedTokens: number;
            try {
              estimatedTokens = await countChunkTokens(chunkOptions);
              logger.debug('ProcessVideo', 'Got token count from API', {
                jobId,
                chunkLabel,
                estimatedTokens,
              });
            } catch {
              // Fallback to formula-based estimation
              const duration =
                Number.parseInt(chunk.endOffset) - Number.parseInt(chunk.startOffset);
              const { totalTokens } = calculateTokens(
                duration,
                job.config.fps,
                job.config.resolution
              );
              estimatedTokens = totalTokens;
              logger.debug('ProcessVideo', 'Using formula-based token estimate', {
                jobId,
                chunkLabel,
                estimatedTokens,
              });
            }

            // Step 2: Acquire rate limit capacity
            const acquireStart = Date.now();
            await rateLimiter.acquire(estimatedTokens, requestId);
            const acquireTime = Date.now() - acquireStart;

            // Mark as processing only after acquiring rate limit capacity
            updateChunkStatus(jobId, chunk.id, 'processing');

            if (acquireTime > 100) {
              logger.info('ProcessVideo', 'Rate limit wait', {
                jobId,
                chunkLabel,
                waitMs: acquireTime,
              });
            }

            // Step 3: Make API call
            const { analysis, usageMetadata } = await analyzeChunk(chunkOptions);

            // Step 4: Record actual tokens
            rateLimiter.recordActual(requestId, usageMetadata.promptTokenCount);

            // Log estimation accuracy
            const accuracy = usageMetadata.promptTokenCount / estimatedTokens;
            if (Math.abs(accuracy - 1) > 0.2) {
              logger.warn('ProcessVideo', 'Token estimation inaccuracy', {
                jobId,
                chunkLabel,
                estimated: estimatedTokens,
                actual: usageMetadata.promptTokenCount,
                accuracy: accuracy.toFixed(2),
              });
            }

            const processingTime = Date.now() - startTime;

            // Validate result
            if (!analysis.events || analysis.events.length === 0) {
              throw new Error(
                `${chunkLabel} returned empty result (no events found). ` +
                  `This usually indicates an API issue or invalid video segment.`
              );
            }

            updateChunkStatus(jobId, chunk.id, 'completed', analysis, undefined, processingTime);
            addTokensUsed(jobId, usageMetadata.promptTokenCount);

            logger.info('ProcessVideo', 'Chunk completed', {
              jobId,
              chunkLabel,
              processingMs: processingTime,
              eventCount: analysis.events.length,
              tokensUsed: usageMetadata.promptTokenCount,
            });

            return analysis;
          },
          failureTracker,
          (attempt) => {
            updateChunkStatus(jobId, chunk.id, 'retrying');
            addLog(jobId, 'info', `${chunkLabel} retry attempt ${attempt}`);
          }
        );

        chunkResults.push(result);
        return result;
      })
    );

    // Wait for all chunks - but check for abort
    try {
      await Promise.all(chunkPromises);
    } catch (error) {
      // Check if this was due to failure thresholds
      if (failureTracker.shouldAbort()) {
        aborted = true;
        throw new Error(failureTracker.getFailureReason());
      }
      throw error;
    }

    // Verify we have all chunks
    if (chunkResults.length !== job.chunks.length) {
      throw new Error(
        `Only ${chunkResults.length}/${job.chunks.length} chunks completed successfully`
      );
    }

    logger.info('ProcessVideo', 'All chunks completed, starting consolidation', {
      jobId,
      successfulChunks: chunkResults.length,
      rateLimiterMetrics: rateLimiter.getMetrics(),
      failureStats: failureTracker.getStats(),
    });

    // Consolidate all chunks with same failure tracking
    updateJobStatus(jobId, 'consolidating');

    // Get token estimate for consolidation
    let consolidationTokens: number;
    try {
      consolidationTokens = await countConsolidationTokens(
        apiKey,
        chunkResults,
        promptPair.consolidation,
        job.config.model
      );
    } catch {
      // Fallback: estimate ~4 chars per token
      const consolidationInput = `${promptPair.consolidation}\n\n${JSON.stringify(chunkResults)}`;
      consolidationTokens = Math.ceil(consolidationInput.length / 4);
    }

    logger.info('ProcessVideo', 'Consolidation token estimate', {
      jobId,
      estimatedTokens: consolidationTokens,
    });

    // Execute consolidation with same retry logic
    const finalTimestamps = await executeWithRetry(
      'Consolidation',
      async () => {
        const requestId = rateLimiter.generateRequestId();

        logger.debug('ProcessVideo', 'Acquiring rate limit for consolidation', {
          jobId,
          estimatedTokens: consolidationTokens,
        });

        await rateLimiter.acquire(consolidationTokens, requestId);

        const { text, usageMetadata } = await consolidateChunks(
          apiKey,
          chunkResults,
          promptPair.consolidation,
          job.config.model
        );

        rateLimiter.recordActual(requestId, usageMetadata.promptTokenCount);

        return text;
      },
      failureTracker,
      (attempt) => {
        addLog(jobId, 'info', `Consolidation retry attempt ${attempt}`);
      }
    );

    logger.info('ProcessVideo', 'Job completed successfully', {
      jobId,
      finalMetrics: rateLimiter.getMetrics(),
      failureStats: failureTracker.getStats(),
    });

    setResult(jobId, finalTimestamps);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('ProcessVideo', 'Job failed', {
      jobId,
      error: errorMessage,
      failureStats: failureTracker.getStats(),
    });
    setError(jobId, errorMessage);
  }
}
