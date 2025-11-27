/**
 * Rate Limit Configuration
 *
 * Centralized rate limit configuration for all Gemini models and tiers.
 * Source: https://ai.google.dev/gemini-api/docs/rate-limits
 *
 * Easy to update when Google changes rate limits.
 */

import { logger } from '../logger';

/** @public Return type of getRateLimits function */
export interface ModelLimits {
  rpm: number; // Requests per minute
  tpm: number; // Tokens per minute
  rpd: number | null; // Requests per day (null = unlimited)
}

export type Tier = 'free' | 'tier1' | 'tier2' | 'tier3';

// Internal type for RATE_LIMITS constant
interface RateLimitConfig {
  [modelName: string]: {
    [tier in Tier]: ModelLimits;
  };
}

/**
 * Rate limits from Gemini API documentation
 * Last updated: 2025-11-26
 */
const RATE_LIMITS: RateLimitConfig = {
  'gemini-2.5-flash': {
    free: { rpm: 10, tpm: 250_000, rpd: 250 },
    tier1: { rpm: 1_000, tpm: 1_000_000, rpd: 10_000 },
    tier2: { rpm: 2_000, tpm: 3_000_000, rpd: 100_000 },
    tier3: { rpm: 10_000, tpm: 8_000_000, rpd: null },
  },
  'gemini-2.5-pro': {
    free: { rpm: 2, tpm: 125_000, rpd: 50 },
    tier1: { rpm: 150, tpm: 2_000_000, rpd: 10_000 },
    tier2: { rpm: 1_000, tpm: 5_000_000, rpd: 50_000 },
    tier3: { rpm: 2_000, tpm: 8_000_000, rpd: null },
  },
  'gemini-2.0-flash': {
    free: { rpm: 15, tpm: 1_000_000, rpd: 200 },
    tier1: { rpm: 2_000, tpm: 4_000_000, rpd: null },
    tier2: { rpm: 10_000, tpm: 10_000_000, rpd: null },
    tier3: { rpm: 30_000, tpm: 30_000_000, rpd: null },
  },
  // Alias for backward compatibility
  'gemini-2.0-flash-exp': {
    free: { rpm: 15, tpm: 1_000_000, rpd: 200 },
    tier1: { rpm: 2_000, tpm: 4_000_000, rpd: null },
    tier2: { rpm: 10_000, tpm: 10_000_000, rpd: null },
    tier3: { rpm: 30_000, tpm: 30_000_000, rpd: null },
  },
};

/**
 * Get rate limits for a specific model and tier
 */
export function getRateLimits(model: string, tier: Tier = 'free'): ModelLimits {
  const modelLimits = RATE_LIMITS[model];

  if (!modelLimits) {
    logger.warn('RateLimits', 'Unknown model, falling back to gemini-2.5-flash', {
      model,
      tier,
    });
    const fallback = RATE_LIMITS['gemini-2.5-flash']?.[tier];
    if (!fallback) {
      throw new Error(`No rate limits found for fallback model gemini-2.5-flash tier ${tier}`);
    }
    return fallback;
  }

  const limits = modelLimits[tier];
  if (!limits) {
    throw new Error(`No rate limits found for model ${model} tier ${tier}`);
  }
  return limits;
}
