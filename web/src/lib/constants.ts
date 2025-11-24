/**
 * Application constants
 */

// Gemini API tier limits (from docs/gemini/)
export const TIER_LIMITS = {
  free: {
    tpm: 250_000, // Tokens per minute
    rpm: 15, // Requests per minute
    rpd: 1500, // Requests per day
  },
  paid: {
    tpm: 4_000_000,
    rpm: 360,
    rpd: -1, // unlimited
  },
} as const;

// Default models
export const DEFAULT_MODELS = {
  flash: 'gemini-2.0-flash-exp',
  pro: 'gemini-2.0-pro-exp',
} as const;

// AIMD Queue constants
export const AIMD_CONFIG = {
  initialConcurrency: 1,
  incrementStep: 1,
  decrementMultiplier: 0.5,
  minConcurrency: 1,
  maxConcurrency: 10,
  retryDelayMs: 1000,
  maxRetries: 3,
  exponentialBackoffBase: 2,
  jitterMs: 500,
} as const;

// Token calculation constants
export const TOKEN_RATES = {
  low: 98, // tokens/second at low resolution
  default: 263, // tokens/second at default resolution
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
