/**
 * Gemini API client wrapper
 * Server-side only - never import this in client components
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { ChunkAnalysis } from '@/types';
import { ChunkAnalysisSchema } from '@/types';

/**
 * Create a Gemini client instance
 */
export function createGeminiClient(apiKey: string) {
  if (typeof window !== 'undefined') {
    throw new Error('createGeminiClient() can only be called server-side');
  }

  return new GoogleGenerativeAI(apiKey);
}

/**
 * Analyze a video chunk using Gemini 2.5 Flash
 * Uses Structured Output for reliable JSON parsing
 */
export async function analyzeChunk(
  apiKey: string,
  videoUrl: string,
  startOffset: string,
  endOffset: string,
  prompt: string,
  fps: number,
  model: string = 'gemini-2.5-flash'
): Promise<ChunkAnalysis> {
  const genAI = createGeminiClient(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          chunk_summary: {
            type: SchemaType.STRING,
            description: 'A concise summary of the entire video segment.',
          },
          events: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                timestamp: {
                  type: SchemaType.STRING,
                  description: 'HH:MM:SS format with leading zeros',
                },
                type: {
                  type: SchemaType.STRING,
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
                title: { type: SchemaType.STRING },
                description: {
                  type: SchemaType.STRING,
                  description: 'Detailed summary with specific names, numbers, quotes',
                },
                visual_context: { type: SchemaType.STRING },
                speaker: {
                  type: SchemaType.STRING,
                  description: 'Name of speaker if identifiable',
                },
              },
              required: ['timestamp', 'type', 'title', 'description'],
            },
          },
        },
        required: ['chunk_summary', 'events'],
      },
    },
  });

  // Parse chunk start offset to inject into prompt
  // e.g., "1500s" → 1500
  const startOffsetSeconds = parseInt(startOffset.replace('s', ''));

  // Inject chunk start offset into prompt template
  const contextualizedPrompt = prompt.replace(
    /{{CHUNK_START_OFFSET}}/g,
    startOffsetSeconds.toString()
  );

  console.warn(
    `[analyzeChunk] Processing chunk: ${startOffset} to ${endOffset} (video: ${videoUrl.substring(0, 50)}...)`
  );
  console.warn(
    `[analyzeChunk] Chunk start offset: ${startOffsetSeconds}s, FPS: ${fps}, Model: ${model}`
  );

  // Upload video with chunk offsets and FPS
  // NOTE: videoMetadata is critical for chunking - without it, Gemini tries to load the entire video!
  // Type assertion needed because SDK types don't include videoMetadata yet (but it works at runtime per docs)
  const result = await generativeModel.generateContent([
    {
      fileData: {
        mimeType: 'video/*', // Use video/* for YouTube URLs (per docs)
        fileUri: videoUrl,
      },
      videoMetadata: {
        startOffset: startOffset,
        endOffset: endOffset,
        fps: fps, // Custom frame rate (e.g., 0.5 = 1 frame every 2 seconds)
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any, // Type assertion: SDK types incomplete but API supports this (see docs/gemini/video-understanding.md)
    {
      text: contextualizedPrompt,
    },
  ]);

  const response = result.response;
  const text = response.text();

  // Parse and validate with Zod
  const json = JSON.parse(text);
  const parsed = ChunkAnalysisSchema.parse(json);

  console.warn(
    `[analyzeChunk] Gemini returned ${parsed.events.length} events for chunk ${startOffset}-${endOffset}`
  );

  return parsed;
}

/**
 * Consolidate all chunk analyses into final timestamp document
 */
export async function consolidateChunks(
  apiKey: string,
  chunkAnalyses: ChunkAnalysis[],
  prompt: string,
  model: string = 'gemini-2.5-flash'
): Promise<string> {
  const genAI = createGeminiClient(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      maxOutputTokens: 65536, // Increase from default 8192 to support long videos
    },
  });

  // Prepare input for consolidation
  const chunksJson = JSON.stringify(chunkAnalyses, null, 2);

  const fullPrompt = `${prompt}\n\n<chunk_data>\n${chunksJson}\n</chunk_data>`;

  console.warn(
    `[consolidateChunks] Processing ${chunkAnalyses.length} chunks, input size: ${fullPrompt.length} chars`
  );

  const result = await generativeModel.generateContent(fullPrompt);
  const responseText = result.response.text();

  // Log finish reason and token usage for debugging
  const candidate = result.response.candidates?.[0];
  console.warn(`[consolidateChunks] Finish reason: ${candidate?.finishReason || 'unknown'}`);
  console.warn(`[consolidateChunks] Output length: ${responseText.length} chars`);

  // Warn if output seems suspiciously short (< 1000 chars for multi-chunk videos)
  if (chunkAnalyses.length > 5 && responseText.length < 1000) {
    console.warn(
      `[consolidateChunks] WARNING: Output suspiciously short (${responseText.length} chars for ${chunkAnalyses.length} chunks)`
    );
  }

  return responseText;
}

/**
 * Validate API key by making a simple test request
 * Returns a list of common model names if successful
 */
export async function listModels(apiKey: string): Promise<string[]> {
  const genAI = createGeminiClient(apiKey);

  try {
    // Make a simple test request to validate the key
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    await model.generateContent('test');

    // If successful, return common model names available on free tier (v1beta API)
    return ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'];
  } catch (error) {
    throw new Error(`Failed to validate API key: ${error}`);
  }
}

/**
 * Detect user tier by sending probe requests
 * Free tier: 15 RPM, 250K TPM
 * Paid tier: 360 RPM, 4M TPM
 */
export async function detectTier(
  apiKey: string
): Promise<{ tier: 'free' | 'paid' | 'unknown'; tpm: number; rpm: number }> {
  const genAI = createGeminiClient(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  try {
    // Send 3 rapid test requests to check rate limits
    const probes = Array(3)
      .fill(null)
      .map(async () => {
        const start = Date.now();
        await model.generateContent('test');
        return Date.now() - start;
      });

    const times = await Promise.all(probes);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

    // If all requests succeed quickly, likely paid tier
    // If any fail with 429, definitely free tier
    if (avgTime < 500) {
      return { tier: 'paid', tpm: 4_000_000, rpm: 360 };
    }

    return { tier: 'free', tpm: 250_000, rpm: 15 };
  } catch (error: unknown) {
    // Check if it's a rate limit error
    if (error instanceof Error && error.message.includes('429')) {
      return { tier: 'free', tpm: 250_000, rpm: 15 };
    }

    // Unknown error - default to free tier to be safe
    return { tier: 'unknown', tpm: 250_000, rpm: 15 };
  }
}
