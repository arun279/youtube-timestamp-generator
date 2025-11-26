/**
 * Video processing logic
 * Separate module so it can be imported by both API routes and Server Actions
 *
 * Uses AdaptiveRateLimiter with dual-track sliding window:
 * - Estimates (from countTokens or formula) for admission control
 * - Actuals (from usageMetadata) to update window state
 */

import {
  getJob,
  updateJobStatus,
  updateChunkStatus,
  addTokensUsed,
  setResult,
  setError,
} from './jobs';
import { AdaptiveRateLimiter, getRateLimits } from './rate-limits';
import {
  analyzeChunk,
  consolidateChunks,
  countChunkTokens,
  countConsolidationTokens,
} from './gemini';
import { DEFAULT_PROMPTS } from './prompts/defaults';
import { calculateTokens } from './utils';
import { logger } from './logger';
import { QUEUE_CONFIG, RATE_LIMIT_CONFIG } from './constants';
import type { ChunkAnalysis } from '@/types';
import PQueue from 'p-queue';

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

  logger.info('ProcessVideo', 'Starting job processing', {
    jobId,
    chunkCount: job.chunks.length,
    resolution: job.config.resolution,
    fps: job.config.fps,
    chunkSizeMinutes: job.config.chunkSize,
  });

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
    // Rate limiting is handled by AdaptiveRateLimiter, not p-queue
    const queue = new PQueue({
      concurrency: QUEUE_CONFIG.maxConcurrent,
    });

    // Process all chunks with rate limiting
    const chunkPromises = job.chunks.map((chunk) =>
      queue.add(async () => {
        const requestId = rateLimiter.generateRequestId();
        const chunkLabel = `chunk-${chunk.id + 1}`;

        updateChunkStatus(jobId, chunk.id, 'processing');
        const startTime = Date.now();

        try {
          // Step 1: Get token estimate (try countTokens, fallback to formula)
          let estimatedTokens: number;
          try {
            estimatedTokens = await countChunkTokens(
              apiKey,
              job.config.videoUrl,
              chunk.startOffset,
              chunk.endOffset,
              DEFAULT_PROMPTS.chunkAnalysis,
              job.config.fps,
              job.config.resolution,
              job.config.model
            );
            logger.debug('ProcessVideo', 'Got token count from API', {
              jobId,
              chunkLabel,
              estimatedTokens,
            });
          } catch {
            // Fallback to formula-based estimation
            const duration = parseInt(chunk.endOffset) - parseInt(chunk.startOffset);
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

          if (acquireTime > 100) {
            logger.info('ProcessVideo', 'Rate limit wait', {
              jobId,
              chunkLabel,
              waitMs: acquireTime,
            });
          }

          // Step 3: Make API call with resolution parameter
          const { analysis, usageMetadata } = await analyzeChunk(
            apiKey,
            job.config.videoUrl,
            chunk.startOffset,
            chunk.endOffset,
            DEFAULT_PROMPTS.chunkAnalysis,
            job.config.fps,
            job.config.resolution, // Pass resolution to API
            job.config.model
          );

          // Step 4: Record actual tokens for rate limiter adaptation
          rateLimiter.recordActual(requestId, usageMetadata.promptTokenCount);

          // Log estimation accuracy for debugging
          const accuracy = usageMetadata.promptTokenCount / estimatedTokens;
          if (Math.abs(accuracy - 1.0) > 0.2) {
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
              `Chunk ${chunk.id + 1} returned empty result (no events found). ` +
                `This usually indicates an API issue or invalid video segment.`
            );
          }

          updateChunkStatus(jobId, chunk.id, 'completed', analysis, undefined, processingTime);

          // Update token usage with actual tokens
          addTokensUsed(jobId, usageMetadata.promptTokenCount);

          logger.info('ProcessVideo', 'Chunk completed', {
            jobId,
            chunkLabel,
            processingMs: processingTime,
            eventCount: analysis.events.length,
            tokensUsed: usageMetadata.promptTokenCount,
          });

          return analysis;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error('ProcessVideo', 'Chunk failed', {
            jobId,
            chunkLabel,
            error: errorMessage,
          });
          updateChunkStatus(jobId, chunk.id, 'error', undefined, errorMessage);
          throw error;
        }
      })
    );

    // Wait for all chunks to complete
    const results = await Promise.allSettled(chunkPromises);

    // Check if any chunks failed
    const failedChunks = results.filter((r) => r.status === 'rejected');
    if (failedChunks.length > 0) {
      logger.error('ProcessVideo', 'Some chunks failed', {
        jobId,
        failedCount: failedChunks.length,
        totalChunks: job.chunks.length,
      });
      setError(jobId, `${failedChunks.length} chunks failed to process`);
      return;
    }

    // Extract successful results
    const chunkAnalyses = results
      .filter((r): r is PromiseFulfilledResult<ChunkAnalysis> => r.status === 'fulfilled')
      .map((r) => r.value);

    logger.info('ProcessVideo', 'All chunks completed, starting consolidation', {
      jobId,
      successfulChunks: chunkAnalyses.length,
      rateLimiterMetrics: rateLimiter.getMetrics(),
    });

    // Consolidate all chunks with rate limiting
    updateJobStatus(jobId, 'consolidating');

    // Get token estimate for consolidation
    let consolidationTokens: number;
    try {
      consolidationTokens = await countConsolidationTokens(
        apiKey,
        chunkAnalyses,
        DEFAULT_PROMPTS.consolidation,
        job.config.model
      );
    } catch {
      // Fallback: estimate ~4 chars per token
      const consolidationInput = `${DEFAULT_PROMPTS.consolidation}\n\n${JSON.stringify(chunkAnalyses)}`;
      consolidationTokens = Math.ceil(consolidationInput.length / 4);
    }

    logger.info('ProcessVideo', 'Consolidation token estimate', {
      jobId,
      estimatedTokens: consolidationTokens,
    });

    const maxConsolidationRetries = 5;
    let consolidationAttempt = 0;
    let finalTimestamps: string | null = null;

    while (consolidationAttempt <= maxConsolidationRetries) {
      try {
        const requestId = rateLimiter.generateRequestId();

        // Acquire rate limit for consolidation
        logger.debug('ProcessVideo', 'Acquiring rate limit for consolidation', {
          jobId,
          attempt: consolidationAttempt + 1,
          estimatedTokens: consolidationTokens,
        });

        await rateLimiter.acquire(consolidationTokens, requestId);

        // Make consolidation API call
        const { text, usageMetadata } = await consolidateChunks(
          apiKey,
          chunkAnalyses,
          DEFAULT_PROMPTS.consolidation,
          job.config.model
        );

        // Record actual tokens
        rateLimiter.recordActual(requestId, usageMetadata.promptTokenCount);

        finalTimestamps = text;
        break; // Success
      } catch (error) {
        consolidationAttempt++;

        if (consolidationAttempt > maxConsolidationRetries) {
          throw error;
        }

        // Calculate retry delay with exponential backoff
        let retryDelayMs = 1000 * Math.pow(2, consolidationAttempt);

        // Try to parse Gemini's "retry in XX.XXs" format
        if (error instanceof Error) {
          const match = error.message.match(/retry in ([\d.]+)s/i);
          if (match) {
            retryDelayMs = Math.ceil(parseFloat(match[1]) * 1000);
          }
        }

        logger.warn('ProcessVideo', 'Consolidation attempt failed, retrying', {
          jobId,
          attempt: consolidationAttempt,
          retryDelayMs,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    if (!finalTimestamps) {
      throw new Error('Consolidation failed after all retries');
    }

    logger.info('ProcessVideo', 'Job completed successfully', {
      jobId,
      finalMetrics: rateLimiter.getMetrics(),
    });

    setResult(jobId, finalTimestamps);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('ProcessVideo', 'Fatal error', { jobId, error: errorMessage });
    setError(jobId, errorMessage);
  }
}
