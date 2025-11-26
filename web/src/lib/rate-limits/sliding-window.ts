/**
 * Sliding Window Rate Limiter
 *
 * Enforces rate limits by tracking all requests within a sliding time window.
 * This directly models API quota enforcement: "X tokens/requests per Y seconds".
 *
 * Mathematical Guarantee:
 * - Before each request: sum(tokens in last windowMs) + newTokens <= limit
 * - This is checked atomically via mutex serialization
 * - Therefore it's impossible to exceed the limit
 */

import { logger } from '../logger';

interface RequestEntry {
  timestamp: number;
  tokens: number;
}

export interface SlidingWindowMetrics {
  /** Currently used tokens/requests in the window */
  used: number;
  /** Maximum allowed in the window (after buffer) */
  limit: number;
  /** Utilization percentage (0-100) */
  utilization: number;
  /** Number of requests tracked in the window */
  requestCount: number;
}

export class SlidingWindow {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly name: string;
  private requestLog: RequestEntry[] = [];

  // Mutex for serializing acquire() calls
  private acquireChain: Promise<void> = Promise.resolve();

  /**
   * Create a new sliding window rate limiter
   *
   * @param limit - Maximum tokens/requests allowed per window
   * @param windowMs - Window duration in milliseconds (default: 60000 = 1 minute)
   * @param name - Optional name for logging (e.g., 'TPM', 'RPM')
   */
  constructor(limit: number, windowMs: number = 60_000, name: string = 'SlidingWindow') {
    this.limit = limit;
    this.windowMs = windowMs;
    this.name = name;
  }

  /**
   * Acquire capacity, blocking until available
   *
   * Uses promise chaining to serialize access and prevent race conditions.
   *
   * @param tokens - Number of tokens to acquire (use 1 for request counting)
   * @returns Promise that resolves when capacity is acquired
   */
  async acquire(tokens: number): Promise<void> {
    const acquisition = this.acquireChain.then(async () => {
      await this.acquireInternal(tokens);
    });

    this.acquireChain = acquisition.catch(() => {}); // Swallow errors in chain

    return acquisition;
  }

  /**
   * Internal acquire implementation (called serially via mutex)
   */
  private async acquireInternal(tokens: number): Promise<void> {
    let iteration = 0;

    while (true) {
      iteration++;
      const now = Date.now();

      // Prune entries outside the window
      this.prune(now);

      // Calculate current usage
      const currentUsage = this.getCurrentUsage();

      // Check if we have capacity
      if (currentUsage + tokens <= this.limit) {
        // Record this request
        this.requestLog.push({ timestamp: now, tokens });

        if (iteration > 1) {
          logger.info(this.name, 'Acquired after retries', {
            tokens,
            iterations: iteration,
            usage: currentUsage + tokens,
            limit: this.limit,
          });
        }

        return;
      }

      // Not enough capacity - calculate wait time
      // Wait until the oldest entry falls out of the window
      const oldestEntry = this.requestLog[0];
      if (!oldestEntry) {
        // No entries but still over limit? This shouldn't happen, but handle it
        logger.warn(this.name, 'No entries but over limit, waiting 1s', {
          tokensNeeded: tokens,
          limit: this.limit,
        });
        await this.sleep(1000);
        continue;
      }

      const waitTime = oldestEntry.timestamp + this.windowMs - now + 100; // +100ms buffer

      if (iteration === 1) {
        logger.info(this.name, 'At capacity, waiting for window to slide', {
          usage: currentUsage,
          limit: this.limit,
          tokensNeeded: tokens,
          waitMs: Math.round(waitTime),
        });
      }

      await this.sleep(Math.max(waitTime, 100));
      // Loop back to re-check
    }
  }

  /**
   * Try to acquire capacity without blocking
   *
   * @param tokens - Number of tokens to acquire
   * @returns true if capacity was acquired, false if would need to wait
   */
  tryAcquire(tokens: number): boolean {
    const now = Date.now();
    this.prune(now);

    const currentUsage = this.getCurrentUsage();

    if (currentUsage + tokens <= this.limit) {
      this.requestLog.push({ timestamp: now, tokens });
      return true;
    }

    return false;
  }

  /**
   * Get estimated wait time until capacity is available
   *
   * @param tokens - Number of tokens needed
   * @returns Milliseconds to wait (0 if capacity available now)
   */
  getWaitTime(tokens: number): number {
    const now = Date.now();
    this.prune(now);

    const currentUsage = this.getCurrentUsage();

    if (currentUsage + tokens <= this.limit) {
      return 0;
    }

    // Find when enough capacity will be freed
    let tokensToFree = currentUsage + tokens - this.limit;
    let waitUntil = now;

    for (const entry of this.requestLog) {
      tokensToFree -= entry.tokens;
      waitUntil = entry.timestamp + this.windowMs;

      if (tokensToFree <= 0) {
        break;
      }
    }

    return Math.max(0, waitUntil - now + 100); // +100ms buffer
  }

  /**
   * Get current metrics for monitoring and UI display
   */
  getMetrics(): SlidingWindowMetrics {
    const now = Date.now();
    this.prune(now);

    const used = this.getCurrentUsage();

    return {
      used,
      limit: this.limit,
      utilization: Math.round((used / this.limit) * 100),
      requestCount: this.requestLog.length,
    };
  }

  /**
   * Get the configured limit
   */
  getLimit(): number {
    return this.limit;
  }

  /**
   * Reset the window (useful for testing)
   */
  reset(): void {
    this.requestLog = [];
  }

  /**
   * Remove entries outside the current window
   */
  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.requestLog = this.requestLog.filter((entry) => entry.timestamp > cutoff);
  }

  /**
   * Sum tokens in current window
   */
  private getCurrentUsage(): number {
    return this.requestLog.reduce((sum, entry) => sum + entry.tokens, 0);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
