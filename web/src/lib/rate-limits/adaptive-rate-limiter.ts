/**
 * Adaptive Rate Limiter with Dual-Track Sliding Window
 *
 * This rate limiter uses two information signals:
 * 1. Estimated tokens (from countTokens or formula) - used for admission control
 * 2. Actual tokens (from usageMetadata) - used to update window state
 *
 * Key Features:
 * - Estimates are used for initial capacity check (can't wait for API response)
 * - Actuals update the window to reflect true usage
 * - Adaptive safety multiplier adjusts based on estimation accuracy
 * - Conservative start with 1.2x multiplier, adapts as data is gathered
 *
 * This approach follows industry best practices:
 * - Trust but verify pattern
 * - Sliding window for strict per-minute enforcement
 * - Reactive adjustment based on ground truth
 */

import { logger } from '../logger';
import { v4 as uuidv4 } from 'uuid';

interface TokenEntry {
  /** When the request was made */
  timestamp: number;
  /** Unique identifier for this request */
  requestId: string;
  /** Estimated tokens (used for admission, before API call) */
  estimated: number;
  /** Actual tokens from usageMetadata (null until response received) */
  actual: number | null;
}

export interface AdaptiveMetrics {
  /** Current tokens in window (using actual where available, estimated otherwise) */
  tokensUsed: number;
  /** Effective token limit (after buffer) */
  tokenLimit: number;
  /** Token utilization percentage */
  tokenUtilization: number;
  /** Current requests in window */
  requestsUsed: number;
  /** Effective request limit (after buffer) */
  requestLimit: number;
  /** Request utilization percentage */
  requestUtilization: number;
  /** Current safety multiplier */
  safetyMultiplier: number;
  /** Average estimation accuracy (actual/estimated) */
  avgAccuracy: number;
  /** Pending requests (actual not yet received) */
  pendingRequests: number;
}

export interface RateLimiterConfig {
  /** Tokens per minute limit */
  tpm: number;
  /** Requests per minute limit */
  rpm: number;
  /** Initial safety multiplier for estimates (default: 1.2) */
  initialSafetyMultiplier?: number;
  /** Minimum safety multiplier (default: 1.0) */
  minSafetyMultiplier?: number;
  /** Maximum safety multiplier (default: 2.5) */
  maxSafetyMultiplier?: number;
  /** Buffer percentage to apply to limits (default: 0.1 = 10%) */
  bufferPercent?: number;
}

export class AdaptiveRateLimiter {
  private readonly windowMs = 60_000; // 1 minute
  private readonly tpmLimit: number;
  private readonly rpmLimit: number;

  private window: TokenEntry[] = [];
  private acquireChain: Promise<void> = Promise.resolve();

  // Adaptive safety multiplier
  private safetyMultiplier: number;
  private readonly minSafetyMultiplier: number;
  private readonly maxSafetyMultiplier: number;
  private accuracyHistory: number[] = [];
  private readonly accuracyHistorySize = 20;

  constructor(config: RateLimiterConfig) {
    const bufferPercent = config.bufferPercent ?? 0.1;
    this.tpmLimit = Math.floor(config.tpm * (1 - bufferPercent));
    this.rpmLimit = Math.max(1, config.rpm - 1); // Keep at least 1 RPM

    this.safetyMultiplier = config.initialSafetyMultiplier ?? 1.2;
    this.minSafetyMultiplier = config.minSafetyMultiplier ?? 1.0;
    this.maxSafetyMultiplier = config.maxSafetyMultiplier ?? 2.5;

    logger.info('AdaptiveRateLimiter', 'Initialized', {
      tpmLimit: this.tpmLimit,
      tpmRaw: config.tpm,
      rpmLimit: this.rpmLimit,
      rpmRaw: config.rpm,
      safetyMultiplier: this.safetyMultiplier,
      bufferPercent,
    });
  }

  /**
   * Generate a unique request ID for tracking
   */
  generateRequestId(): string {
    return uuidv4().slice(0, 8);
  }

  /**
   * Acquire capacity for a request
   *
   * Blocks until both TPM and RPM have capacity.
   * Uses estimated tokens with safety multiplier for admission control.
   *
   * @param estimatedTokens - Token estimate (from countTokens or formula)
   * @param requestId - Unique ID for this request (use generateRequestId())
   */
  async acquire(estimatedTokens: number, requestId: string): Promise<void> {
    const acquisition = this.acquireChain.then(async () => {
      await this.acquireInternal(estimatedTokens, requestId);
    });

    this.acquireChain = acquisition.catch(() => {});
    return acquisition;
  }

  /**
   * Internal acquire - serialized via promise chain
   */
  private async acquireInternal(estimatedTokens: number, requestId: string): Promise<void> {
    const safeEstimate = Math.ceil(estimatedTokens * this.safetyMultiplier);
    const startTime = Date.now();
    let iteration = 0;

    while (true) {
      iteration++;
      this.pruneWindow();

      const { tokensUsed, requestsUsed } = this.getWindowUsage();

      // Check both TPM and RPM capacity
      const tpmOk = tokensUsed + safeEstimate <= this.tpmLimit;
      const rpmOk = requestsUsed + 1 <= this.rpmLimit;

      if (tpmOk && rpmOk) {
        // Record the request with estimated tokens
        this.window.push({
          timestamp: Date.now(),
          requestId,
          estimated: safeEstimate,
          actual: null,
        });

        const waitTime = Date.now() - startTime;
        if (waitTime > 100) {
          logger.info('AdaptiveRateLimiter', 'Acquired after wait', {
            requestId,
            estimatedTokens,
            safeEstimate,
            waitMs: waitTime,
            tokensUsed: tokensUsed + safeEstimate,
            tokenLimit: this.tpmLimit,
            requestsUsed: requestsUsed + 1,
            requestLimit: this.rpmLimit,
            safetyMultiplier: this.safetyMultiplier,
          });
        } else {
          logger.debug('AdaptiveRateLimiter', 'Acquired', {
            requestId,
            estimatedTokens,
            safeEstimate,
          });
        }

        return;
      }

      // Calculate wait time
      const waitTime = this.calculateWaitTime(safeEstimate);

      if (iteration === 1) {
        const bottleneck = !tpmOk ? 'TPM' : 'RPM';
        logger.info('AdaptiveRateLimiter', 'Waiting for capacity', {
          requestId,
          bottleneck,
          waitMs: waitTime,
          tokensUsed,
          tokenLimit: this.tpmLimit,
          requestsUsed,
          requestLimit: this.rpmLimit,
        });
      }

      await this.sleep(Math.max(waitTime, 100));
    }
  }

  /**
   * Record actual token usage after API call completes
   *
   * Updates the window entry with ground truth, enabling accurate
   * window state and safety multiplier adaptation.
   *
   * @param requestId - The request ID from acquire()
   * @param actualTokens - Actual tokens from usageMetadata.promptTokenCount
   */
  recordActual(requestId: string, actualTokens: number): void {
    const entry = this.window.find((e) => e.requestId === requestId);

    if (!entry) {
      logger.warn('AdaptiveRateLimiter', 'Request not found for actual recording', {
        requestId,
        actualTokens,
      });
      return;
    }

    const previousEstimate = entry.estimated;
    entry.actual = actualTokens;

    // Calculate accuracy (actual / estimated-without-safety)
    const rawEstimate = previousEstimate / this.safetyMultiplier;
    const accuracy = actualTokens / rawEstimate;

    // Track accuracy history
    this.accuracyHistory.push(accuracy);
    if (this.accuracyHistory.length > this.accuracyHistorySize) {
      this.accuracyHistory.shift();
    }

    // Adapt safety multiplier based on recent accuracy
    this.adaptSafetyMultiplier();

    logger.debug('AdaptiveRateLimiter', 'Recorded actual tokens', {
      requestId,
      estimated: previousEstimate,
      actual: actualTokens,
      accuracy: accuracy.toFixed(2),
      safetyMultiplier: this.safetyMultiplier.toFixed(2),
    });
  }

  /**
   * Adapt safety multiplier based on estimation accuracy history
   *
   * If estimates are consistently low (actual > estimated), increase multiplier.
   * If estimates are consistently high (actual < estimated), decrease multiplier.
   */
  private adaptSafetyMultiplier(): void {
    if (this.accuracyHistory.length < 5) {
      return; // Need enough data to adapt
    }

    const recent = this.accuracyHistory.slice(-10);
    const avgAccuracy = recent.reduce((a, b) => a + b, 0) / recent.length;
    const maxAccuracy = Math.max(...recent);

    // Target: keep max observed accuracy covered with 10% buffer
    const targetMultiplier = maxAccuracy * 1.1;

    // Smooth adjustment: move 20% toward target
    const newMultiplier = this.safetyMultiplier + (targetMultiplier - this.safetyMultiplier) * 0.2;

    // Clamp to configured bounds
    this.safetyMultiplier = Math.max(
      this.minSafetyMultiplier,
      Math.min(this.maxSafetyMultiplier, newMultiplier)
    );

    logger.debug('AdaptiveRateLimiter', 'Adapted safety multiplier', {
      avgAccuracy: avgAccuracy.toFixed(2),
      maxAccuracy: maxAccuracy.toFixed(2),
      targetMultiplier: targetMultiplier.toFixed(2),
      newMultiplier: this.safetyMultiplier.toFixed(2),
    });
  }

  /**
   * Get current window usage
   *
   * Uses actual tokens where available, estimated otherwise.
   * This gives the most accurate picture of real usage.
   */
  private getWindowUsage(): { tokensUsed: number; requestsUsed: number } {
    let tokensUsed = 0;

    for (const entry of this.window) {
      // Prefer actual if available, otherwise use estimated
      tokensUsed += entry.actual ?? entry.estimated;
    }

    return {
      tokensUsed,
      requestsUsed: this.window.length,
    };
  }

  /**
   * Calculate wait time until capacity is available
   */
  private calculateWaitTime(tokensNeeded: number): number {
    if (this.window.length === 0) {
      return 1000; // Default wait if no entries
    }

    const now = Date.now();
    const { tokensUsed, requestsUsed } = this.getWindowUsage();

    // Calculate when enough capacity will be freed for TPM
    let tpmWait = 0;
    if (tokensUsed + tokensNeeded > this.tpmLimit) {
      let tokensToFree = tokensUsed + tokensNeeded - this.tpmLimit;
      for (const entry of this.window) {
        const entryTokens = entry.actual ?? entry.estimated;
        tokensToFree -= entryTokens;
        tpmWait = entry.timestamp + this.windowMs - now + 100;
        if (tokensToFree <= 0) break;
      }
    }

    // Calculate when enough capacity will be freed for RPM
    let rpmWait = 0;
    if (requestsUsed + 1 > this.rpmLimit) {
      const oldestEntry = this.window[0];
      if (oldestEntry) {
        rpmWait = oldestEntry.timestamp + this.windowMs - now + 100;
      }
    }

    return Math.max(tpmWait, rpmWait, 100);
  }

  /**
   * Remove entries outside the sliding window
   */
  private pruneWindow(): void {
    const cutoff = Date.now() - this.windowMs;
    this.window = this.window.filter((entry) => entry.timestamp > cutoff);
  }

  /**
   * Get comprehensive metrics for monitoring and debugging
   */
  getMetrics(): AdaptiveMetrics {
    this.pruneWindow();
    const { tokensUsed, requestsUsed } = this.getWindowUsage();

    const pendingRequests = this.window.filter((e) => e.actual === null).length;
    const avgAccuracy =
      this.accuracyHistory.length > 0
        ? this.accuracyHistory.reduce((a, b) => a + b, 0) / this.accuracyHistory.length
        : 1.0;

    return {
      tokensUsed,
      tokenLimit: this.tpmLimit,
      tokenUtilization: Math.round((tokensUsed / this.tpmLimit) * 100),
      requestsUsed,
      requestLimit: this.rpmLimit,
      requestUtilization: Math.round((requestsUsed / this.rpmLimit) * 100),
      safetyMultiplier: this.safetyMultiplier,
      avgAccuracy,
      pendingRequests,
    };
  }

  /**
   * Get current safety multiplier
   */
  getSafetyMultiplier(): number {
    return this.safetyMultiplier;
  }

  /**
   * Get the configured limits
   */
  getLimits(): { tpm: number; rpm: number } {
    return { tpm: this.tpmLimit, rpm: this.rpmLimit };
  }

  /**
   * Reset the rate limiter (useful for testing)
   */
  reset(): void {
    this.window = [];
    this.accuracyHistory = [];
    this.safetyMultiplier = 1.2;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
