/**
 * Gemini API client wrapper
 * Server-side only - never import this in client components
 *
 * Uses the @google/genai SDK for:
 * - mediaResolution support
 * - countTokens() for accurate token estimation
 * - usageMetadata for ground truth token tracking
 */

import { GoogleGenAI, MediaResolution, Type } from '@google/genai';

import { ChunkAnalysisSchema, type ChunkAnalysis, type MediaResolutionType } from '@/types';

import { logger } from './logger';

/**
 * Map our resolution type to SDK MediaResolution enum
 */
function toMediaResolution(resolution: MediaResolutionType): MediaResolution {
  switch (resolution) {
    case 'low':
      return MediaResolution.MEDIA_RESOLUTION_LOW;
    case 'medium':
      return MediaResolution.MEDIA_RESOLUTION_MEDIUM;
    case 'high':
      return MediaResolution.MEDIA_RESOLUTION_HIGH;
    default:
      return MediaResolution.MEDIA_RESOLUTION_LOW; // Safe default
  }
}

/**
 * Create a Gemini client instance (internal use only)
 */
function createGeminiClient(apiKey: string): GoogleGenAI {
  if (globalThis.window !== undefined) {
    throw new TypeError('createGeminiClient() can only be called server-side');
  }

  return new GoogleGenAI({ apiKey });
}

/**
 * Result of analyzeChunk including usage metadata for rate limiter
 * @public Return type of analyzeChunk function
 */
export interface AnalyzeChunkResult {
  analysis: ChunkAnalysis;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Options for chunk processing functions
 * @public Shared options for countChunkTokens and analyzeChunk
 */
export interface ChunkProcessingOptions {
  readonly apiKey: string;
  readonly videoUrl: string;
  readonly startOffset: string;
  readonly endOffset: string;
  readonly prompt: string;
  readonly fps: number;
  readonly resolution: MediaResolutionType;
  readonly model?: string;
}

/**
 * Estimate tokens for a video chunk
 *
 * NOTE: We use formula-based estimation because the countTokens API:
 * 1. Doesn't support videoMetadata (startOffset/endOffset) for chunking
 * 2. Doesn't support mediaResolution config
 * This would cause it to count the ENTIRE video at DEFAULT resolution,
 * vastly overestimating token usage.
 *
 * The formula is based on official Gemini documentation:
 * https://ai.google.dev/gemini-api/docs/media-resolution
 */
export async function countChunkTokens(options: ChunkProcessingOptions): Promise<number> {
  const { startOffset, endOffset, fps, resolution } = options;
  // Formula-based estimation using official token rates
  const durationSeconds =
    Number.parseInt(endOffset.replace('s', ''), 10) -
    Number.parseInt(startOffset.replace('s', ''), 10);
  const tokensPerFrame = resolution === 'low' ? 64 : 256;
  const audioTokensPerSecond = 32;
  const estimatedTokens = Math.ceil(
    (fps * tokensPerFrame + audioTokensPerSecond) * durationSeconds
  );

  logger.debug('Gemini', 'Token estimate for chunk', {
    chunk: `${startOffset}-${endOffset}`,
    durationSeconds,
    fps,
    resolution,
    tokensPerFrame,
    estimatedTokens,
  });

  return estimatedTokens;
}

/**
 * Analyze a video chunk using Gemini 2.5 Flash
 * Uses Structured Output for reliable JSON parsing
 * Returns both the analysis and usage metadata for rate limiter updates
 */
export async function analyzeChunk(options: ChunkProcessingOptions): Promise<AnalyzeChunkResult> {
  const {
    apiKey,
    videoUrl,
    startOffset,
    endOffset,
    prompt,
    fps,
    resolution,
    model = 'gemini-2.5-flash',
  } = options;

  const ai = createGeminiClient(apiKey);

  // Parse chunk start offset to inject into prompt
  const startOffsetSeconds = Number.parseInt(startOffset.replace('s', ''), 10);

  // Inject chunk start offset into prompt template
  const contextualizedPrompt = prompt.replaceAll(
    '{{CHUNK_START_OFFSET}}',
    startOffsetSeconds.toString()
  );

  logger.info('Gemini', 'Processing chunk', {
    chunk: `${startOffset}-${endOffset}`,
    startOffsetSeconds,
    fps,
    resolution,
    mediaResolution: toMediaResolution(resolution),
    model,
  });

  // Log timestamp when request is being sent
  logger.debug('Gemini', 'Sending API request', {
    chunk: `${startOffset}-${endOffset}`,
  });

  // Define response schema for structured output
  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      chunk_summary: {
        type: Type.STRING,
        description: 'A concise summary of the entire video segment.',
      },
      events: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            timestamp: {
              type: Type.STRING,
              description: 'HH:MM:SS format with leading zeros',
            },
            type: {
              type: Type.STRING,
              enum: [
                'Main Topic',
                'Sub-topic',
                'Sponsor',
                'Merch',
                'Banter',
                'Technical',
                'Intro',
                'Outro',
                'Speaker Change',
                'Discussion Point',
              ],
            },
            title: { type: Type.STRING },
            description: {
              type: Type.STRING,
              description: 'Detailed summary with specific names, numbers, quotes',
            },
            visual_context: { type: Type.STRING },
            speaker: {
              type: Type.STRING,
              description: 'Name of speaker if identifiable',
            },
          },
          required: ['timestamp', 'type', 'title', 'description'],
        },
      },
    },
    required: ['chunk_summary', 'events'],
  };

  const result = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            fileData: {
              mimeType: 'video/*',
              fileUri: videoUrl,
            },
            // Video metadata for chunking and FPS (API supports but SDK types incomplete)
            videoMetadata: {
              startOffset,
              endOffset,
              fps,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {
            text: contextualizedPrompt,
          },
        ],
      },
    ],
    config: {
      mediaResolution: toMediaResolution(resolution),
      responseMimeType: 'application/json',
      responseSchema,
    },
  });

  // Log timestamp when response is received
  logger.debug('Gemini', 'Received API response', {
    chunk: `${startOffset}-${endOffset}`,
  });

  const text = result.text ?? '';

  // Extract usage metadata for rate limiter
  const usageMetadata = {
    promptTokenCount: result.usageMetadata?.promptTokenCount ?? 0,
    candidatesTokenCount: result.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokenCount: result.usageMetadata?.totalTokenCount ?? 0,
  };

  logger.info('Gemini', 'Token usage for chunk', {
    chunk: `${startOffset}-${endOffset}`,
    inputTokens: usageMetadata.promptTokenCount,
    outputTokens: usageMetadata.candidatesTokenCount,
    totalTokens: usageMetadata.totalTokenCount,
    resolution,
  });

  // Parse and validate with Zod
  const json = JSON.parse(text);
  const analysis = ChunkAnalysisSchema.parse(json);

  logger.info('Gemini', 'Chunk analysis complete', {
    chunk: `${startOffset}-${endOffset}`,
    eventCount: analysis.events.length,
  });

  return { analysis, usageMetadata };
}

/**
 * Result of consolidateChunks including usage metadata
 * @public Return type of consolidateChunks function
 */
export interface ConsolidateResult {
  text: string;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Count tokens for consolidation request
 */
export async function countConsolidationTokens(
  apiKey: string,
  chunkAnalyses: ChunkAnalysis[],
  prompt: string,
  model: string = 'gemini-2.5-flash'
): Promise<number> {
  const ai = createGeminiClient(apiKey);
  const chunksJson = JSON.stringify(chunkAnalyses, null, 2);
  const fullPrompt = `${prompt}\n\n<chunk_data>\n${chunksJson}\n</chunk_data>`;

  try {
    const tokenCount = await ai.models.countTokens({
      model,
      contents: fullPrompt,
    });

    logger.debug('Gemini', 'Consolidation token count', {
      totalTokens: tokenCount.totalTokens,
      promptLength: fullPrompt.length,
    });

    return tokenCount.totalTokens ?? 0;
  } catch (error) {
    // Fallback: estimate ~4 chars per token
    logger.warn('Gemini', 'countTokens failed for consolidation, using estimate', {
      error: error instanceof Error ? error.message : String(error),
    });
    return Math.ceil(fullPrompt.length / 4);
  }
}

/**
 * Consolidate all chunk analyses into final timestamp document
 * Returns both the text and usage metadata for rate limiter updates
 */
export async function consolidateChunks(
  apiKey: string,
  chunkAnalyses: ChunkAnalysis[],
  prompt: string,
  model: string = 'gemini-2.5-flash'
): Promise<ConsolidateResult> {
  const ai = createGeminiClient(apiKey);

  // Prepare input for consolidation
  const chunksJson = JSON.stringify(chunkAnalyses, null, 2);
  const fullPrompt = `${prompt}\n\n<chunk_data>\n${chunksJson}\n</chunk_data>`;

  logger.info('Gemini', 'Processing consolidation', {
    chunkCount: chunkAnalyses.length,
    inputChars: fullPrompt.length,
  });

  logger.debug('Gemini', 'Sending consolidation API request');

  const result = await ai.models.generateContent({
    model,
    contents: fullPrompt,
    config: {
      maxOutputTokens: 65536, // Support long videos
    },
  });

  logger.debug('Gemini', 'Received consolidation API response');

  const text = result.text ?? '';

  const usageMetadata = {
    promptTokenCount: result.usageMetadata?.promptTokenCount ?? 0,
    candidatesTokenCount: result.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokenCount: result.usageMetadata?.totalTokenCount ?? 0,
  };

  // Get finish reason from candidates
  const finishReason = result.candidates?.[0]?.finishReason ?? 'unknown';

  logger.info('Gemini', 'Consolidation complete', {
    finishReason,
    outputChars: text.length,
    inputTokens: usageMetadata.promptTokenCount,
    outputTokens: usageMetadata.candidatesTokenCount,
    totalTokens: usageMetadata.totalTokenCount,
  });

  // Warn if output seems suspiciously short
  if (chunkAnalyses.length > 5 && text.length < 1000) {
    logger.warn('Gemini', 'Output suspiciously short', {
      outputChars: text.length,
      chunkCount: chunkAnalyses.length,
    });
  }

  return { text, usageMetadata };
}

/**
 * Validate API key by making a simple test request
 * Returns a list of common model names if successful
 */
export async function listModels(apiKey: string): Promise<string[]> {
  const ai = createGeminiClient(apiKey);

  try {
    // Make a simple test request to validate the key
    await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'test',
    });

    // If successful, return common model names
    return ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to validate API key: ${message}`);
  }
}

/** Tier detection configuration */
const TIER_DETECTION = {
  /** Number of probe requests to send */
  probeCount: 3,
  /** Response time threshold (ms) - faster indicates paid tier */
  paidTierThresholdMs: 500,
  /** Default tier limits */
  tiers: {
    free: { tier: 'free' as const, tpm: 250_000, rpm: 10 },
    tier1: { tier: 'tier1' as const, tpm: 1_000_000, rpm: 1_000 },
  },
} as const;

/**
 * Detect user tier by sending probe requests
 * Returns 'free' as default if detection fails
 */
export async function detectTier(
  apiKey: string
): Promise<{ tier: 'free' | 'tier1'; tpm: number; rpm: number }> {
  const ai = createGeminiClient(apiKey);

  try {
    // Send rapid test requests to check rate limits
    const measureRequestTime = async (): Promise<number> => {
      const start = Date.now();
      await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: 'test',
      });
      return Date.now() - start;
    };

    const probes = Array.from({ length: TIER_DETECTION.probeCount }, measureRequestTime);
    const times = await Promise.all(probes);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

    // If all requests succeed quickly, likely paid tier
    if (avgTime < TIER_DETECTION.paidTierThresholdMs) {
      return TIER_DETECTION.tiers.tier1;
    }

    return TIER_DETECTION.tiers.free;
  } catch (error: unknown) {
    // Check if it's a rate limit error (429)
    if (error instanceof Error && error.message.includes('429')) {
      return TIER_DETECTION.tiers.free;
    }

    // Unknown error - default to free tier to be safe
    return TIER_DETECTION.tiers.free;
  }
}
