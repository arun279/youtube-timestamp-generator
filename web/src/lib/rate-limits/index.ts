/**
 * Rate Limiting Module
 *
 * Provides adaptive rate limiting for Gemini API requests.
 * Uses sliding window to enforce TPM and RPM limits.
 *
 * @example
 * ```typescript
 * import { AdaptiveRateLimiter, getRateLimits } from '@/lib/rate-limits';
 *
 * const limits = getRateLimits('gemini-2.5-flash', 'free');
 * const rateLimiter = new AdaptiveRateLimiter({
 *   tpm: limits.tpm,
 *   rpm: limits.rpm,
 * });
 *
 * await rateLimiter.acquire(estimatedTokens, requestId);
 * // ... make API call
 * rateLimiter.recordActual(requestId, actualTokens);
 * ```
 */

// Main exports - used by process-video.ts
export { AdaptiveRateLimiter } from './adaptive-rate-limiter';
export { getRateLimits, type Tier } from './config';
