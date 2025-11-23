'use server';

/**
 * Server Action: Validate Gemini API key
 * Checks if key is valid and detects tier
 */

import { listModels, detectTier } from '@/lib/gemini';
import { validateApiKeyFormat } from '@/lib/utils';
import type { ApiKeyValidationResult } from '@/types';

export async function validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
  try {
    // Basic format validation
    if (!validateApiKeyFormat(apiKey)) {
      return {
        isValid: false,
        error: 'Invalid API key format. Gemini keys start with "AIza"',
      };
    }

    // Try to list models (verifies key works)
    const models = await listModels(apiKey);
    
    if (models.length === 0) {
      return {
        isValid: false,
        error: 'API key is valid but no models are available',
      };
    }

    // Detect tier with probe requests
    const tierInfo = await detectTier(apiKey);

    return {
      isValid: true,
      models,
      tier: tierInfo.tier,
      tpm: tierInfo.tpm,
      rpm: tierInfo.rpm,
    };
  } catch (error: unknown) {
    // Handle specific error cases
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      
      if (message.includes('401') || message.includes('unauthorized')) {
        return {
          isValid: false,
          error: 'Invalid API key. Please check your key and try again.',
        };
      }
      
      if (message.includes('403') || message.includes('forbidden')) {
        return {
          isValid: false,
          error: 'API key does not have permission to access Gemini models.',
        };
      }
      
      if (message.includes('429') || message.includes('quota')) {
        return {
          isValid: true,
          models: [],
          tier: 'free',
          tpm: 250_000,
          rpm: 15,
          error: 'API key is valid but rate limited. You may be on the free tier.',
        };
      }
      
      if (message.includes('network') || message.includes('econnrefused')) {
        return {
          isValid: false,
          error: 'Network error. Please check your internet connection.',
        };
      }

      return {
        isValid: false,
        error: `Validation failed: ${error.message}`,
      };
    }

    return {
      isValid: false,
      error: 'Unknown error occurred during validation',
    };
  }
}

