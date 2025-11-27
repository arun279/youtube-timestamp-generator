/**
 * Client-side storage utilities for API keys and custom prompts
 * Supports both sessionStorage (ephemeral) and localStorage (persistent)
 */

import { hashString } from './utils';
import { STORAGE_KEYS } from './constants';
import type { StoredApiKey } from '@/types';

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

// NOTE: Custom prompt storage and server API key features removed
// as they were never implemented. See git history if needed.
