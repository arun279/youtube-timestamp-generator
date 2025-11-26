/**
 * Rate Limiting Module
 *
 * Provides sliding window-based rate limiting for API requests.
 * Enforces both TPM (Tokens Per Minute) and RPM (Requests Per Minute) limits.
 *
 * @example
 * ```typescript
 * import { RateLimiter, ProcessingQueue, getRateLimits } from '@/lib/rate-limits';
 *
 * // Get limits for model and tier
 * const limits = getRateLimits('gemini-2.5-flash', 'free');
 *
 * // Create rate limiter (applies default buffers: 10% TPM, 1 RPM)
 * const rateLimiter = new RateLimiter(limits);
 *
 * // Or with custom buffer config
 * const rateLimiter = new RateLimiter(limits, {
 *   tpmBufferPercent: 0.15,  // 15% buffer
 *   rpmBufferCount: 2,       // Reduce RPM limit by 2
 * });
 *
 * // Create processing queue
 * const queue = new ProcessingQueue(rateLimiter);
 *
 * // Add tasks
 * await queue.add(async () => {
 *   return await apiCall();
 * }, estimatedTokens);
 * ```
 */

export { SlidingWindow, type SlidingWindowMetrics } from './sliding-window';
export { RateLimiter, type RateLimiterMetrics } from './rate-limiter';
export { ProcessingQueue, type ProcessingQueueOptions } from './processing-queue';
export {
  AdaptiveRateLimiter,
  type AdaptiveMetrics,
  type RateLimiterConfig,
} from './adaptive-rate-limiter';
export {
  RATE_LIMITS,
  DEFAULT_TOKEN_SAFETY_BUFFER,
  DEFAULT_SAFETY_BUFFER,
  DEFAULT_BUFFER_CONFIG,
  getRateLimits,
  getEffectiveLimits,
  applyTokenSafetyBuffer,
  type ModelLimits,
  type Tier,
  type RateLimitConfig,
  type BufferConfig,
} from './config';
