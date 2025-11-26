import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Hash a string using SHA-256 (for API key storage keying)
 */
export async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Calculate tokens for video processing
 * Based on Gemini API token calculations
 */
export function calculateTokens(
  durationSeconds: number,
  fps: number,
  resolution: 'low' | 'default'
): {
  tokensPerSecond: number;
  totalTokens: number;
} {
  // Token rates from Gemini docs
  const baseTokensPerSecond = resolution === 'low' ? 98 : 263;

  // FPS adjustment (proportional)
  const fpsMultiplier = fps / 1.0; // 1.0 FPS is the baseline

  const tokensPerSecond = baseTokensPerSecond * fpsMultiplier;
  const totalTokens = Math.ceil(tokensPerSecond * durationSeconds);

  return { tokensPerSecond, totalTokens };
}

/**
 * Validate API key format (Gemini keys start with "AIza")
 */
export function validateApiKeyFormat(key: string): boolean {
  return key.startsWith('AIza') && key.length > 20;
}

/**
 * Extract video ID from YouTube URL
 */
export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Normalize YouTube URL to canonical form
 * Strips query parameters and returns: https://www.youtube.com/watch?v=VIDEO_ID
 */
export function normalizeYouTubeUrl(url: string): string | null {
  const videoId = extractYouTubeId(url);
  if (!videoId) return null;

  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Format seconds to HH:MM:SS
 */
export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0'),
  ].join(':');
}

/**
 * Parse HH:MM:SS to seconds
 */
export function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Format duration in a human-readable way
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Generate chunks for video processing
 */
export function generateChunks(
  durationSeconds: number,
  chunkSizeMinutes: number,
  fps: number,
  resolution: 'low' | 'default'
): Array<{
  id: number;
  startOffset: string;
  endOffset: string;
  estimatedTokens: number;
}> {
  const chunkSizeSeconds = chunkSizeMinutes * 60;
  const chunks = [];

  for (let i = 0; i < durationSeconds; i += chunkSizeSeconds) {
    const start = i;
    const end = Math.min(i + chunkSizeSeconds, durationSeconds);
    const duration = end - start;

    const { totalTokens } = calculateTokens(duration, fps, resolution);

    chunks.push({
      id: chunks.length,
      startOffset: `${start}s`,
      endOffset: `${end}s`,
      estimatedTokens: totalTokens,
    });
  }

  return chunks;
}

/**
 * Calculate ETA based on progress
 */
export function calculateETA(
  completedChunks: number,
  totalChunks: number,
  elapsedMs: number
): number | null {
  if (completedChunks === 0) return null;

  const avgTimePerChunk = elapsedMs / completedChunks;
  const remainingChunks = totalChunks - completedChunks;

  return Math.ceil((avgTimePerChunk * remainingChunks) / 1000); // seconds
}

/**
 * Sanitize user input for prompts (prevent XSS)
 */
export function sanitizePrompt(prompt: string): string {
  // Remove script tags and potentially dangerous content
  return prompt
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
}

/**
 * Debounce function for search/input
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
