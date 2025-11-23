/**
 * Client-side storage utilities for API keys and custom prompts
 * Supports both sessionStorage (ephemeral) and localStorage (persistent)
 */

import { hashString } from './utils';
import { STORAGE_KEYS } from './constants';
import type { StoredApiKey, CustomPrompt } from '@/types';

// ============================================================================
// API Key Storage
// ============================================================================

export const ApiKeyStorage = {
  /**
   * Save API key
   * @param key - The Gemini API key
   * @param persist - If true, use localStorage; otherwise sessionStorage
   * @param metadata - Additional metadata (tier, models)
   */
  async save(
    key: string,
    persist: boolean,
    metadata: Pick<StoredApiKey, 'tier' | 'models'>
  ): Promise<void> {
    const hash = await hashString(key);
    const storage = persist ? localStorage : sessionStorage;
    
    const stored: StoredApiKey = {
      key,
      hash,
      ...metadata,
    };

    storage.setItem(STORAGE_KEYS.apiKey, JSON.stringify(stored));
  },

  /**
   * Get stored API key
   * Checks sessionStorage first, then localStorage
   */
  get(): StoredApiKey | null {
    // Check session first (ephemeral takes precedence)
    const sessionData = sessionStorage.getItem(STORAGE_KEYS.apiKey);
    if (sessionData) {
      try {
        return JSON.parse(sessionData);
      } catch {
        // Invalid data, clear it
        sessionStorage.removeItem(STORAGE_KEYS.apiKey);
      }
    }

    // Check localStorage (persistent)
    const localData = localStorage.getItem(STORAGE_KEYS.apiKey);
    if (localData) {
      try {
        return JSON.parse(localData);
      } catch {
        localStorage.removeItem(STORAGE_KEYS.apiKey);
      }
    }

    return null;
  },

  /**
   * Get just the key string (for server actions)
   */
  getKey(): string | null {
    const stored = this.get();
    return stored?.key ?? null;
  },

  /**
   * Clear API key from both storages
   */
  clear(): void {
    sessionStorage.removeItem(STORAGE_KEYS.apiKey);
    localStorage.removeItem(STORAGE_KEYS.apiKey);
  },

  /**
   * Check if a key is stored
   */
  exists(): boolean {
    return this.get() !== null;
  },

  /**
   * Get hash of stored key (for prompt keying)
   */
  async getHash(): Promise<string | null> {
    const stored = this.get();
    return stored?.hash ?? null;
  },
};

// ============================================================================
// Custom Prompt Storage
// ============================================================================

export const PromptStorage = {
  /**
   * Save custom prompt
   * @param promptType - 'chunkAnalysis' or 'consolidation'
   * @param content - The custom prompt content
   * @param apiKeyHash - Hash of the API key (for multi-user support)
   */
  save(promptType: string, content: string, apiKeyHash: string): void {
    const key = `${apiKeyHash}_${promptType}`;
    const allPrompts = this.getAll();

    allPrompts[key] = {
      content,
      modifiedAt: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEYS.customPrompts, JSON.stringify(allPrompts));
  },

  /**
   * Get custom prompt
   */
  get(promptType: string, apiKeyHash: string): CustomPrompt | null {
    const key = `${apiKeyHash}_${promptType}`;
    const allPrompts = this.getAll();
    return allPrompts[key] ?? null;
  },

  /**
   * Get all custom prompts
   */
  getAll(): Record<string, CustomPrompt> {
    const data = localStorage.getItem(STORAGE_KEYS.customPrompts);
    if (!data) return {};

    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  },

  /**
   * Delete a custom prompt (revert to default)
   */
  delete(promptType: string, apiKeyHash: string): void {
    const key = `${apiKeyHash}_${promptType}`;
    const allPrompts = this.getAll();
    delete allPrompts[key];
    localStorage.setItem(STORAGE_KEYS.customPrompts, JSON.stringify(allPrompts));
  },

  /**
   * Check if custom prompt exists
   */
  exists(promptType: string, apiKeyHash: string): boolean {
    return this.get(promptType, apiKeyHash) !== null;
  },

  /**
   * Clear all custom prompts
   */
  clearAll(): void {
    localStorage.removeItem(STORAGE_KEYS.customPrompts);
  },
};

// ============================================================================
// Environment Variable Access (Server-side)
// ============================================================================

/**
 * Get API key from environment (server-side only)
 * Used for self-hosting with a shared key
 */
export function getServerApiKey(): string | undefined {
  // Only accessible server-side
  if (typeof window !== 'undefined') {
    throw new Error('getServerApiKey() can only be called server-side');
  }
  return process.env.GEMINI_API_KEY;
}

