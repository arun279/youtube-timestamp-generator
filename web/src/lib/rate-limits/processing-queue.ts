/**
 * Processing Queue
 *
 * Manages job execution with rate limiting, error handling, and concurrency control.
 *
 * The sliding window rate limiter provides the primary rate limiting. The maxConcurrent
 * parameter is a safety cap to prevent resource exhaustion.
 *
 * IMPORTANT: Failed requests do NOT release their rate limit quota.
 * This is intentional - the API may have already counted the request against quota,
 * so we must assume it was consumed. Retries wait for the window to slide naturally.
 */

import PQueue from 'p-queue';
import type { RateLimiter } from './rate-limiter';
import { logger } from '../logger';

export interface ProcessingQueueOptions {
  maxConcurrent?: number; // Safety cap (default: 10)
  maxRetries?: number; // Per-task retry limit (default: 5)
  backoffBase?: number; // Exponential backoff base (default: 2)
  backoffMax?: number; // Maximum backoff delay in ms (default: 60000)
  onWait?: (waitTimeMs: number) => void; // Called when waiting for rate limit
  onRetry?: (attempt: number, maxRetries: number, error: Error) => void; // Called on retry
  onError?: (error: Error, metadata?: unknown) => void; // Called on final error
}

interface TaskMetadata {
  estimatedTokens: number;
  retries: number;
  metadata?: unknown;
}

export class ProcessingQueue {
  private queue: PQueue;
  private rateLimiter: RateLimiter;
  private readonly options: Required<
    Omit<ProcessingQueueOptions, 'onWait' | 'onRetry' | 'onError'>
  >;
  private readonly onWait?: (waitTimeMs: number) => void;
  private readonly onRetry?: (attempt: number, maxRetries: number, error: Error) => void;
  private readonly onError?: (error: Error, metadata?: unknown) => void;

  constructor(rateLimiter: RateLimiter, options: ProcessingQueueOptions = {}) {
    this.rateLimiter = rateLimiter;

    // Set defaults
    this.options = {
      maxConcurrent: options.maxConcurrent ?? 10,
      maxRetries: options.maxRetries ?? 5,
      backoffBase: options.backoffBase ?? 2,
      backoffMax: options.backoffMax ?? 60_000,
    };

    this.onWait = options.onWait;
    this.onRetry = options.onRetry;
    this.onError = options.onError;

    // Create p-queue with safety concurrency cap
    this.queue = new PQueue({
      concurrency: this.options.maxConcurrent,
    });
  }

  /**
   * Add a task to the queue
   *
   * @param task - The async function to execute
   * @param estimatedTokens - Estimated token count for rate limiting
   * @param metadata - Optional metadata for logging/debugging
   * @returns Promise that resolves with task result
   */
  async add<T>(task: () => Promise<T>, estimatedTokens: number, metadata?: unknown): Promise<T> {
    const taskMeta: TaskMetadata = {
      estimatedTokens,
      retries: 0,
      metadata,
    };

    return this.queue.add(() => this.executeWithRetry(task, taskMeta)) as Promise<T>;
  }

  /**
   * Execute task with retry logic
   */
  private async executeWithRetry<T>(task: () => Promise<T>, taskMeta: TaskMetadata): Promise<T> {
    let lastError: Error | undefined;
    const taskId = this.formatMetadata(taskMeta.metadata);

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        // Acquire rate limit (blocks until available)
        const acquireStart = Date.now();
        await this.rateLimiter.acquire(taskMeta.estimatedTokens);
        const acquireTime = Date.now() - acquireStart;

        // Notify if we waited for rate limit
        if (acquireTime > 100) {
          this.onWait?.(acquireTime);
        }

        // Execute task
        const executeStart = Date.now();
        const result = await task();
        const executeTime = Date.now() - executeStart;

        // Log successful completion (useful for debugging timing issues)
        if (acquireTime > 1000 || executeTime > 30000) {
          logger.info('ProcessingQueue', `${taskId} completed`, {
            waitMs: Math.round(acquireTime),
            executeMs: Math.round(executeTime),
          });
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Log the error with full details for debugging
        const metrics = this.rateLimiter.getMetrics();
        logger.error('ProcessingQueue', `${taskId} failed`, {
          attempt: attempt + 1,
          maxAttempts: this.options.maxRetries + 1,
          error: lastError.message.slice(0, 300),
          tpmUsed: metrics.tpm.used,
          tpmLimit: metrics.tpm.limit,
          rpmUsed: metrics.rpm.used,
          rpmLimit: metrics.rpm.limit,
        });

        // NOTE: We do NOT release rate limit on error.
        // The API may have already counted the request against our quota,
        // so we must assume it was consumed. Retries will wait for the
        // sliding window to naturally slide past this request.

        // Check if we should retry
        if (attempt < this.options.maxRetries && this.isRetryable(lastError)) {
          // Calculate backoff delay
          const backoffMs = this.calculateBackoff(
            attempt,
            lastError,
            this.options.backoffBase,
            this.options.backoffMax
          );

          // Notify retry callback
          this.onRetry?.(attempt + 1, this.options.maxRetries, lastError);

          logger.info('ProcessingQueue', `${taskId} will retry`, {
            backoffMs: Math.round(backoffMs),
            nextAttempt: attempt + 2,
            maxAttempts: this.options.maxRetries + 1,
          });

          // Wait before retry
          await this.sleep(backoffMs);

          // Continue to next attempt
          continue;
        }

        // Max retries exceeded or non-retryable error
        break;
      }
    }

    // Task failed after all retries
    logger.error('ProcessingQueue', `${taskId} FAILED permanently`, {
      totalAttempts: this.options.maxRetries + 1,
      finalError: lastError!.message.slice(0, 300),
    });
    this.onError?.(lastError!, taskMeta.metadata);
    throw lastError!;
  }

  /**
   * Format metadata for logging
   */
  private formatMetadata(metadata?: unknown): string {
    if (!metadata) return 'Task';
    if (typeof metadata === 'object' && metadata !== null) {
      const obj = metadata as Record<string, unknown>;
      if ('chunkId' in obj) return `Chunk ${obj.chunkId}`;
      if ('id' in obj) return `Task ${obj.id}`;
    }
    return `Task(${String(metadata).slice(0, 20)})`;
  }

  /**
   * Check if an error is retryable
   */
  private isRetryable(error: Error): boolean {
    const message = error.message.toLowerCase();

    // 503 Service Unavailable - retry
    if (message.includes('503') || message.includes('overloaded')) {
      return true;
    }

    // Network errors - retry
    if (
      message.includes('network') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('timeout') ||
      message.includes('fetch failed') ||
      message.includes('socket hang up') ||
      message.includes('econnrefused')
    ) {
      return true;
    }

    // 429 Rate Limit - should not occur with proper rate limiting
    if (message.includes('429') || message.includes('rate limit') || message.includes('quota')) {
      const metrics = this.rateLimiter.getMetrics();
      const retryAfter = this.extractRetryAfter(error);
      logger.warn('ProcessingQueue', 'RATE LIMIT HIT (429) despite sliding window', {
        diagnosis: 'Token estimation too low or API behavior changed',
        tpmUsed: metrics.tpm.used,
        tpmLimit: metrics.tpm.limit,
        tpmUtilization: metrics.tpm.utilization,
        rpmUsed: metrics.rpm.used,
        rpmLimit: metrics.rpm.limit,
        rpmUtilization: metrics.rpm.utilization,
        retryAfterSec: retryAfter > 0 ? retryAfter : undefined,
      });
      return true;
    }

    // 500 Internal Server Error - retry
    if (message.includes('500') || message.includes('internal server')) {
      return true;
    }

    // Other errors are not retryable
    return false;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(attempt: number, error: Error, base: number, max: number): number {
    // Try to extract Retry-After header from error message
    const retryAfter = this.extractRetryAfter(error);
    if (retryAfter > 0) {
      return Math.min(retryAfter * 1000, max);
    }

    // For 503 errors, use longer base delay
    const message = error.message.toLowerCase();
    const baseDelay = message.includes('503') ? 5_000 : 1_000;

    // Exponential backoff: baseDelay * (base ^ attempt)
    const exponential = baseDelay * Math.pow(base, attempt);

    // Add jitter (0-10% of delay)
    const jitter = Math.random() * exponential * 0.1;

    return Math.min(exponential + jitter, max);
  }

  /**
   * Extract Retry-After value from error message
   */
  private extractRetryAfter(error: Error): number {
    // Try to match "retry in XX.XXs" format (Gemini format)
    const match = error.message.match(/retry in ([\d.]+)s/i);
    if (match) {
      return Math.ceil(parseFloat(match[1]));
    }

    return 0;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      size: this.queue.size,
      pending: this.queue.pending,
      isPaused: this.queue.isPaused,
    };
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue.clear();
  }

  /**
   * Wait for queue to be idle
   */
  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }

  /**
   * Get the rate limiter metrics
   */
  getMetrics() {
    return this.rateLimiter.getMetrics();
  }
}
