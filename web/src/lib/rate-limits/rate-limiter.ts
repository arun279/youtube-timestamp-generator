/**
 * Rate Limiter
 *
 * Combines TPM (Tokens Per Minute) and RPM (Requests Per Minute) sliding windows
 * into a unified rate limiting interface.
 *
 * Enforces BOTH limits - a request must pass both windows to proceed.
 *
 */

import { SlidingWindow, type SlidingWindowMetrics } from './sliding-window';
import {
  type ModelLimits,
  type BufferConfig,
  DEFAULT_BUFFER_CONFIG,
  getEffectiveLimits,
} from './config';
import { logger } from '../logger';

export interface RateLimiterMetrics {
  tpm: SlidingWindowMetrics;
  rpm: SlidingWindowMetrics;
  bottleneck: 'tpm' | 'rpm' | 'none';
}

export class RateLimiter {
  private tpmWindow: SlidingWindow;
  private rpmWindow: SlidingWindow;
  private readonly limits: ModelLimits;
  private readonly effectiveLimits: ModelLimits;

  // Mutex for serializing acquire() calls across both windows
  private acquireChain: Promise<void> = Promise.resolve();

  /**
   * Create a new rate limiter
   *
   * @param limits - Model-specific rate limits
   * @param bufferConfig - Optional buffer configuration (defaults to 10% TPM, 1 RPM)
   */
  constructor(limits: ModelLimits, bufferConfig: BufferConfig = DEFAULT_BUFFER_CONFIG) {
    this.limits = limits;
    this.effectiveLimits = getEffectiveLimits(limits, bufferConfig);

    // Create sliding windows with effective (buffered) limits
    // Window duration is 60 seconds (1 minute)
    this.tpmWindow = new SlidingWindow(this.effectiveLimits.tpm, 60_000, 'TPM');
    this.rpmWindow = new SlidingWindow(this.effectiveLimits.rpm, 60_000, 'RPM');

    logger.info('RateLimiter', 'Initialized with effective limits', {
      tpm: this.effectiveLimits.tpm,
      tpmRaw: limits.tpm,
      rpm: this.effectiveLimits.rpm,
      rpmRaw: limits.rpm,
    });
  }

  /**
   * Acquire rate limit for a request
   *
   * Blocks until both TPM and RPM windows have sufficient capacity.
   * Both limits are checked atomically to prevent race conditions.
   *
   * @param estimatedTokens - Estimated token count for the request
   */
  async acquire(estimatedTokens: number): Promise<void> {
    // Serialize all acquisitions to ensure atomic check of both limits
    const acquisition = this.acquireChain.then(async () => {
      await this.acquireInternal(estimatedTokens);
    });

    this.acquireChain = acquisition.catch(() => {});

    return acquisition;
  }

  /**
   * Internal acquire - checks and acquires from both windows atomically
   */
  private async acquireInternal(estimatedTokens: number): Promise<void> {
    const startTime = Date.now();
    let iteration = 0;

    while (true) {
      iteration++;

      const tpmMetrics = this.tpmWindow.getMetrics();
      const rpmMetrics = this.rpmWindow.getMetrics();

      // Check if both windows have capacity
      const tpmOk = tpmMetrics.used + estimatedTokens <= tpmMetrics.limit;
      const rpmOk = rpmMetrics.used + 1 <= rpmMetrics.limit;

      if (tpmOk && rpmOk) {
        // Both have capacity - acquire from both (non-blocking since we checked)
        this.tpmWindow.tryAcquire(estimatedTokens);
        this.rpmWindow.tryAcquire(1);

        const waitTime = Date.now() - startTime;
        if (waitTime > 100) {
          logger.info('RateLimiter', 'Acquired after wait', {
            tokens: estimatedTokens,
            waitMs: waitTime,
            tpmBefore: tpmMetrics.used,
            tpmAfter: tpmMetrics.used + estimatedTokens,
            tpmLimit: tpmMetrics.limit,
            rpmBefore: rpmMetrics.used,
            rpmAfter: rpmMetrics.used + 1,
            rpmLimit: rpmMetrics.limit,
          });
        }

        return;
      }

      // Need to wait - determine which is the bottleneck and how long
      const tpmWait = tpmOk ? 0 : this.tpmWindow.getWaitTime(estimatedTokens);
      const rpmWait = rpmOk ? 0 : this.rpmWindow.getWaitTime(1);
      const waitTime = Math.max(tpmWait, rpmWait);

      if (iteration === 1) {
        const bottleneck = tpmWait >= rpmWait ? 'TPM' : 'RPM';
        logger.info('RateLimiter', 'Waiting for capacity', {
          waitMs: Math.round(waitTime),
          bottleneck,
          tpmUsed: tpmMetrics.used,
          tpmLimit: tpmMetrics.limit,
          rpmUsed: rpmMetrics.used,
          rpmLimit: rpmMetrics.limit,
        });
      }

      // Wait for the longer of the two
      await this.sleep(Math.max(waitTime, 100));
      // Loop back to re-check
    }
  }

  /**
   * Try to acquire rate limit without blocking
   *
   * @param estimatedTokens - Estimated token count for the request
   * @returns true if rate limit acquired, false if would need to wait
   */
  tryAcquire(estimatedTokens: number): boolean {
    const tpmMetrics = this.tpmWindow.getMetrics();
    const rpmMetrics = this.rpmWindow.getMetrics();

    const tpmOk = tpmMetrics.used + estimatedTokens <= tpmMetrics.limit;
    const rpmOk = rpmMetrics.used + 1 <= rpmMetrics.limit;

    if (tpmOk && rpmOk) {
      this.tpmWindow.tryAcquire(estimatedTokens);
      this.rpmWindow.tryAcquire(1);
      return true;
    }

    return false;
  }

  /**
   * Get wait time until request can proceed
   *
   * @param estimatedTokens - Estimated token count for the request
   * @returns Milliseconds to wait (max of TPM and RPM wait times)
   */
  getWaitTime(estimatedTokens: number): number {
    const tpmWait = this.tpmWindow.getWaitTime(estimatedTokens);
    const rpmWait = this.rpmWindow.getWaitTime(1);
    return Math.max(tpmWait, rpmWait);
  }

  /**
   * Get metrics for monitoring and UI display
   */
  getMetrics(): RateLimiterMetrics {
    const tpm = this.tpmWindow.getMetrics();
    const rpm = this.rpmWindow.getMetrics();

    // Determine which is the bottleneck
    let bottleneck: 'tpm' | 'rpm' | 'none' = 'none';
    if (tpm.utilization > rpm.utilization && tpm.utilization > 50) {
      bottleneck = 'tpm';
    } else if (rpm.utilization > tpm.utilization && rpm.utilization > 50) {
      bottleneck = 'rpm';
    }

    return { tpm, rpm, bottleneck };
  }

  /**
   * Calculate maximum chunks per minute based on current limits
   *
   * @param tokensPerChunk - Tokens consumed by each chunk
   * @returns { tpmLimit, rpmLimit, effective } where effective is the tighter constraint
   */
  getChunksPerMinute(tokensPerChunk: number): {
    tpmLimit: number;
    rpmLimit: number;
    effective: number;
  } {
    const tpmLimit = this.effectiveLimits.tpm / tokensPerChunk;
    const rpmLimit = this.effectiveLimits.rpm;
    const effective = Math.min(tpmLimit, rpmLimit);

    return {
      tpmLimit: Number(tpmLimit.toFixed(2)),
      rpmLimit,
      effective: Number(effective.toFixed(2)),
    };
  }

  /**
   * Reset both windows (useful for testing)
   */
  reset(): void {
    this.tpmWindow.reset();
    this.rpmWindow.reset();
  }

  /**
   * Get the configured limits (raw, before buffers)
   */
  getLimits(): ModelLimits {
    return { ...this.limits };
  }

  /**
   * Get the effective limits (after buffers applied)
   */
  getEffectiveLimits(): ModelLimits {
    return { ...this.effectiveLimits };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
