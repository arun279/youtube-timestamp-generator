/**
 * Application constants
 */

/** @public Available Gemini models */
export const DEFAULT_MODELS = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
} as const;

// Processing Queue Configuration
export const QUEUE_CONFIG = {
  maxConcurrent: 10, // Safety cap - sliding window is primary control
} as const;

/**
 * Job failure thresholds
 * Controls when to fail a job based on task failures
 *
 * These thresholds implement a circuit breaker pattern:
 * - consecutiveFailures: Catches sustained issues (service outage, bad API key)
 * - totalFailures: Catches flaky situations (intermittent errors)
 *
 * Designed to preserve the Gemini API free tier quota (250 RPD)
 * while allowing recovery from transient 503 errors.
 */
export const FAILURE_CONFIG = {
  /**
   * Max consecutive failures before failing the job
   * If 3 tasks fail in a row, something is fundamentally broken
   */
  maxConsecutiveFailures: 3,

  /**
   * Max total failures before failing the job
   * Even if not consecutive, 5 failures indicates too much instability
   */
  maxTotalFailures: 5,

  /**
   * Base delay for retries (ms)
   * Used when Gemini doesn't provide a retry-after value
   */
  baseRetryDelayMs: 1000,

  /**
   * Maximum retry delay (ms)
   * Cap to prevent extremely long waits
   */
  maxRetryDelayMs: 60_000,

  /**
   * Backoff multiplier for exponential backoff
   * delay = baseRetryDelayMs * (backoffMultiplier ^ attempt)
   */
  backoffMultiplier: 2,
} as const;

/**
 * Rate limiting configuration
 * These values are shared between UI (TokenCalculator) and backend (AdaptiveRateLimiter)
 * to ensure consistent estimates and behavior
 */
export const RATE_LIMIT_CONFIG = {
  /**
   * Safety multiplier applied to token estimates
   * Accounts for estimation inaccuracy (~12% observed underestimate)
   * The adaptive rate limiter will adjust this based on actual usage
   */
  initialSafetyMultiplier: 1.2,

  /**
   * Buffer percentage applied to TPM/RPM limits
   * Provides headroom for Google's tracking differences
   */
  limitBufferPercent: 0.1,
} as const;

/**
 * Token calculation constants from official Gemini API documentation
 * Source: https://ai.google.dev/gemini-api/docs/media-resolution
 *
 * For Gemini 2.5 models:
 * - LOW: 64 tokens per frame
 * - MEDIUM: 256 tokens per frame
 * - HIGH: 256 tokens per frame (same as medium)
 * - Audio: 32 tokens per second (always included)
 *
 * Formula: tokensPerSecond = (fps × tokensPerFrame) + audioTokensPerSecond
 */
export const TOKEN_CONSTANTS = {
  // Tokens per frame by resolution (Gemini 2.5)
  tokensPerFrame: {
    low: 64,
    medium: 256,
    high: 256,
  },
  // Audio is always 32 tokens/second regardless of resolution
  audioTokensPerSecond: 32,
} as const;

/**
 * Calculate tokens per second based on resolution and FPS
 * @public
 * @param resolution - Media resolution setting
 * @param fps - Frames per second
 * @returns Tokens per second
 */
export function calculateTokensPerSecond(
  resolution: 'low' | 'medium' | 'high',
  fps: number
): number {
  const tokensPerFrame = TOKEN_CONSTANTS.tokensPerFrame[resolution];
  return fps * tokensPerFrame + TOKEN_CONSTANTS.audioTokensPerSecond;
}

/**
 * Calculate total tokens for a video segment
 * @public
 * @param durationSeconds - Duration in seconds
 * @param resolution - Media resolution setting
 * @param fps - Frames per second
 * @returns Total tokens estimate
 */
export function calculateTotalTokens(
  durationSeconds: number,
  resolution: 'low' | 'medium' | 'high',
  fps: number
): number {
  const tokensPerSecond = calculateTokensPerSecond(resolution, fps);
  return Math.ceil(tokensPerSecond * durationSeconds);
}

/**
 * Default processing configuration values
 * Used to ensure consistency across InputSection and other components
 */
export const DEFAULT_CONFIG = {
  /** Default chunk size in minutes (15 min for safety margin with free tier) */
  chunkSize: 15,
  /** Default frames per second for video analysis */
  fps: 0.5,
  /** Default resolution for video analysis */
  resolution: 'low' as const,
  /** Default Gemini model */
  model: 'gemini-2.5-flash',
  /** Default tier */
  tier: 'free' as const,
  /** Default concurrency mode */
  concurrencyMode: 'adaptive' as const,
} as const;

// Storage keys
export const STORAGE_KEYS = {
  apiKey: 'ytts_api_key',
  customPrompts: 'ytts_custom_prompts',
} as const;

// SSE configuration
export const SSE_CONFIG = {
  heartbeatInterval: 15000, // 15 seconds
  reconnectDelay: 2000, // 2 seconds
  maxReconnectAttempts: 5,
} as const;

// Job retention
export const JOB_CONFIG = {
  retentionMs: 60 * 60 * 1000, // 1 hour
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
} as const;
