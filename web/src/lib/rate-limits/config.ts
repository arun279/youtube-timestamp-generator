/**
 * Rate Limit Configuration
 *
 * Centralized rate limit configuration for all Gemini models and tiers.
 * Source: https://ai.google.dev/gemini-api/docs/rate-limits
 *
 * Easy to update when Google changes rate limits.
 */

import { logger } from '../logger';

export interface ModelLimits {
  rpm: number; // Requests per minute
  tpm: number; // Tokens per minute
  rpd: number | null; // Requests per day (null = unlimited)
}

export type Tier = 'free' | 'tier1' | 'tier2' | 'tier3';

export interface RateLimitConfig {
  [modelName: string]: {
    [tier in Tier]: ModelLimits;
  };
}

/**
 * Rate limits from Gemini API documentation
 * Last updated: 2025-11-26
 */
export const RATE_LIMITS: RateLimitConfig = {
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
 * Default safety buffer to add to token estimates (10%)
 * This inflates estimated tokens before checking against TPM limit
 */
export const DEFAULT_TOKEN_SAFETY_BUFFER = 0.1;

/**
 * @deprecated Use DEFAULT_TOKEN_SAFETY_BUFFER instead
 */
export const DEFAULT_SAFETY_BUFFER = DEFAULT_TOKEN_SAFETY_BUFFER;

/**
 * Buffer configuration for rate limits
 * These reduce the effective limits to provide safety margin
 */
export interface BufferConfig {
  /** TPM buffer as percentage (0.1 = 10% reduction) */
  tpmBufferPercent: number;
  /** RPM buffer as absolute count (1 = reduce limit by 1) */
  rpmBufferCount: number;
}

/**
 * Default buffer configuration
 * - TPM: 10% buffer (250K -> 225K effective)
 * - RPM: 1 request buffer (10 -> 9 effective)
 */
export const DEFAULT_BUFFER_CONFIG: BufferConfig = {
  tpmBufferPercent: 0.1,
  rpmBufferCount: 1,
};

/**
 * Calculate effective limits after applying buffers
 */
export function getEffectiveLimits(
  limits: ModelLimits,
  bufferConfig: BufferConfig = DEFAULT_BUFFER_CONFIG
): ModelLimits {
  return {
    rpm: Math.max(limits.rpm - bufferConfig.rpmBufferCount, 1),
    tpm: Math.floor(limits.tpm * (1 - bufferConfig.tpmBufferPercent)),
    rpd: limits.rpd,
  };
}

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
    return RATE_LIMITS['gemini-2.5-flash'][tier];
  }

  return modelLimits[tier];
}

/**
 * Calculate token estimate with safety buffer
 */
export function applyTokenSafetyBuffer(
  estimatedTokens: number,
  buffer: number = DEFAULT_TOKEN_SAFETY_BUFFER
): number {
  return Math.ceil(estimatedTokens * (1 + buffer));
}
