/**
 * AIMD (Additive Increase, Multiplicative Decrease) Queue
 * Dynamically adjusts concurrency based on rate limit responses
 * 
 * Features:
 * - Starts at concurrency 1, gradually increases
 * - On 429 error, cuts concurrency in half and pauses
 * - Respects Retry-After headers
 * - Exponential backoff with jitter for retries
 * - Tier-aware (free vs paid tier limits)
 */

import PQueue from 'p-queue';
import { AIMD_CONFIG } from './constants';

export interface AIMDQueueOptions {
  tier: 'free' | 'paid' | 'unknown';
  tpm: number;
  rpm: number;
  onConcurrencyChange?: (from: number, to: number, reason: string) => void;
  onRateLimit?: (retryAfterMs: number) => void;
}

export class AIMDQueue {
  private queue: PQueue;
  private currentConcurrency: number;
  private readonly tier: 'free' | 'paid' | 'unknown';
  private readonly tpm: number;
  private readonly rpm: number;
  private readonly onConcurrencyChange?: (from: number, to: number, reason: string) => void;
  private readonly onRateLimit?: (retryAfterMs: number) => void;
  
  // Retry tracking
  private retryCount = 0;
  private isPaused = false;

  constructor(options: AIMDQueueOptions) {
    this.tier = options.tier;
    this.tpm = options.tpm;
    this.rpm = options.rpm;
    this.onConcurrencyChange = options.onConcurrencyChange;
    this.onRateLimit = options.onRateLimit;
    
    this.currentConcurrency = AIMD_CONFIG.initialConcurrency;
    
    this.queue = new PQueue({
      concurrency: this.currentConcurrency,
      interval: 60000, // 1 minute
      intervalCap: this.rpm,
    });
  }

  /**
   * Add a task to the queue with automatic retry and rate limit handling
   */
  add<T>(
    task: () => Promise<T>,
    retries: number = AIMD_CONFIG.maxRetries
  ): Promise<T> {
    return this.queue.add(async () => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          // Wait if paused (rate limited)
          while (this.isPaused) {
            await this.sleep(1000);
          }

          const result = await task();
          
          // Success! Increase concurrency (Additive Increase)
          if (attempt === 0) {
            this.increaseConcurrency();
          }
          
          // Reset retry counter on success
          this.retryCount = 0;
          
          return result;
        } catch (error: unknown) {
          const isRateLimit = this.isRateLimitError(error);
          
          if (isRateLimit) {
            // Extract Retry-After header if present
            const retryAfterMs = this.extractRetryAfter(error);
            
            // Decrease concurrency (Multiplicative Decrease)
            this.decreaseConcurrency('Rate limit (429) detected');
            
            // Pause queue
            this.isPaused = true;
            this.onRateLimit?.(retryAfterMs);
            
            // Wait with exponential backoff + jitter
            const backoffMs = this.calculateBackoff(attempt, retryAfterMs);
            await this.sleep(backoffMs);
            
            // Resume
            this.isPaused = false;
            
            // Retry
            if (attempt < retries) {
              this.retryCount++;
              continue;
            }
          }
          
          // Non-rate-limit error or max retries exceeded
          throw error;
        }
      }
      
      throw new Error('Max retries exceeded');
    }) as Promise<T>;
  }

  /**
   * Increase concurrency (Additive Increase)
   */
  private increaseConcurrency(): void {
    const oldConcurrency = this.currentConcurrency;
    const maxConcurrency = this.getMaxConcurrency();
    
    if (this.currentConcurrency < maxConcurrency) {
      this.currentConcurrency = Math.min(
        this.currentConcurrency + AIMD_CONFIG.incrementStep,
        maxConcurrency
      );
      
      this.queue.concurrency = this.currentConcurrency;
      
      this.onConcurrencyChange?.(
        oldConcurrency,
        this.currentConcurrency,
        'Success - increasing concurrency'
      );
    }
  }

  /**
   * Decrease concurrency (Multiplicative Decrease)
   */
  private decreaseConcurrency(reason: string): void {
    const oldConcurrency = this.currentConcurrency;
    
    this.currentConcurrency = Math.max(
      Math.floor(this.currentConcurrency * AIMD_CONFIG.decrementMultiplier),
      AIMD_CONFIG.minConcurrency
    );
    
    this.queue.concurrency = this.currentConcurrency;
    
    this.onConcurrencyChange?.(
      oldConcurrency,
      this.currentConcurrency,
      reason
    );
  }

  /**
   * Get maximum concurrency based on tier
   */
  private getMaxConcurrency(): number {
    // For free tier, be conservative (max 3-4)
    // For paid tier, can go higher
    if (this.tier === 'free') {
      return Math.min(4, AIMD_CONFIG.maxConcurrency);
    }
    return AIMD_CONFIG.maxConcurrency;
  }

  /**
   * Check if error is a rate limit error (429)
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('429') || message.includes('rate limit') || message.includes('quota');
    }
    return false;
  }

  /**
   * Extract Retry-After header from error (if present)
   */
  private extractRetryAfter(error: unknown): number {
    // Try to extract Retry-After from error message or headers
    // Default to base retry delay if not found
    if (error instanceof Error) {
      // Try pattern 1: "retry in XX.XXs" (Gemini format)
      let match = error.message.match(/retry in ([\d.]+)s/i);
      if (match) {
        return Math.ceil(parseFloat(match[1]) * 1000); // Convert seconds to ms, round up
      }
      
      // Try pattern 2: "retry-after: XX" (standard header format)
      match = error.message.match(/retry[- ]after[:\s]+(\d+)/i);
      if (match) {
        return parseInt(match[1], 10) * 1000; // Convert seconds to ms
      }
    }
    return AIMD_CONFIG.retryDelayMs;
  }

  /**
   * Calculate backoff with exponential increase and jitter
   */
  private calculateBackoff(attempt: number, baseMs: number): number {
    const exponential = baseMs * Math.pow(AIMD_CONFIG.exponentialBackoffBase, attempt);
    const jitter = Math.random() * AIMD_CONFIG.jitterMs;
    return exponential + jitter;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current concurrency level
   */
  getConcurrency(): number {
    return this.currentConcurrency;
  }

  /**
   * Get queue size
   */
  getSize(): number {
    return this.queue.size;
  }

  /**
   * Get pending count
   */
  getPending(): number {
    return this.queue.pending;
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
}

