/**
 * Video processing logic
 * Separate module so it can be imported by both API routes and Server Actions
 */

import { getJob, updateJobStatus, updateChunkStatus, updateConcurrency, addTokensUsed, setResult, setError } from './jobs';
import { AIMDQueue } from './queue';
import { analyzeChunk, consolidateChunks } from './gemini';
import { DEFAULT_PROMPTS } from './prompts/defaults';
import { calculateTokens } from './utils';
import type { ChunkAnalysis } from '@/types';

/**
 * Background processing function
 * Processes all video chunks and consolidates results
 */
export async function processVideoInBackground(jobId: string, apiKey: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) {
    console.error(`[processVideoInBackground] Job ${jobId} not found`);
    return;
  }

  console.log(`[processVideoInBackground] Starting processing for job ${jobId} with ${job.chunks.length} chunks`);

  try {
    updateJobStatus(jobId, 'processing');

    // Create AIMD queue with tier awareness
    const queue = new AIMDQueue({
      tier: 'free', // TODO: Get from API key validation stored in job
      tpm: 250_000,
      rpm: 15,
      onConcurrencyChange: (from, to, reason) => {
        updateConcurrency(jobId, to);
        console.log(`[${jobId}] Concurrency: ${from} → ${to} (${reason})`);
      },
      onRateLimit: (retryAfterMs) => {
        console.log(`[${jobId}] Rate limited. Retrying in ${retryAfterMs}ms`);
      },
      onRetry: (attempt, maxRetries, error, metadata) => {
        if (metadata && typeof metadata === 'object' && 'chunkId' in metadata) {
          const chunkId = (metadata as { chunkId: number }).chunkId;
          updateChunkStatus(jobId, chunkId, 'retrying');
          console.log(`[${jobId}] Chunk ${chunkId + 1} retry attempt ${attempt}/${maxRetries}: ${error.message}`);
        }
      },
    });

    // Process all chunks
    const chunkPromises = job.chunks.map(chunk =>
      queue.add(async () => {
        updateChunkStatus(jobId, chunk.id, 'processing');
        
        const startTime = Date.now();
        
        try {
          const result = await analyzeChunk(
            apiKey,
            job.config.videoUrl,
            chunk.startOffset,
            chunk.endOffset,
            DEFAULT_PROMPTS.chunkAnalysis,
            job.config.fps,
            job.config.model
          );

          const processingTime = Date.now() - startTime;

          // Validate that the result has actual events
          // Empty results indicate API failure or invalid chunk data
          if (!result.events || result.events.length === 0) {
            const errorMessage = `Chunk ${chunk.id + 1} returned empty result (no events found). This usually indicates an API issue or invalid video segment.`;
            console.error(`[${jobId}]`, errorMessage);
            throw new Error(errorMessage);
          }

          updateChunkStatus(jobId, chunk.id, 'completed', result, undefined, processingTime);

          // Update token usage
          const duration = parseInt(chunk.endOffset) - parseInt(chunk.startOffset);
          const { totalTokens } = calculateTokens(
            duration,
            job.config.fps,
            job.config.resolution
          );
          addTokensUsed(jobId, totalTokens);

          console.log(`[${jobId}] Chunk ${chunk.id + 1} completed in ${processingTime}ms with ${result.events.length} events`);

          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[${jobId}] Chunk ${chunk.id + 1} failed:`, errorMessage);
          updateChunkStatus(jobId, chunk.id, 'error', undefined, errorMessage);
          throw error;
        }
      }, undefined, { chunkId: chunk.id })
    );

    // Wait for all chunks to complete
    const results = await Promise.allSettled(chunkPromises);

    // Check if any chunks failed
    const failedChunks = results.filter(r => r.status === 'rejected');
    if (failedChunks.length > 0) {
      console.error(`[${jobId}] ${failedChunks.length} chunks failed`);
      setError(jobId, `${failedChunks.length} chunks failed to process`);
      return;
    }

    // Extract successful results
    const chunkAnalyses = results
      .filter((r): r is PromiseFulfilledResult<ChunkAnalysis> => r.status === 'fulfilled')
      .map(r => r.value);

    console.log(`[${jobId}] All chunks completed. Starting consolidation...`);

    // Consolidate all chunks with retry logic
    updateJobStatus(jobId, 'consolidating');
    
    const maxConsolidationRetries = 5;
    let consolidationAttempt = 0;
    let finalTimestamps: string | null = null;

    while (consolidationAttempt <= maxConsolidationRetries) {
      try {
        finalTimestamps = await consolidateChunks(
          apiKey,
          chunkAnalyses,
          DEFAULT_PROMPTS.consolidation,
          job.config.model
        );
        break; // Success - exit retry loop
      } catch (error) {
        consolidationAttempt++;
        
        if (consolidationAttempt > maxConsolidationRetries) {
          // Max retries exceeded
          throw error;
        }

        // Extract retry delay from error message
        let retryDelayMs = 1000 * Math.pow(2, consolidationAttempt); // Default exponential backoff
        
        if (error instanceof Error) {
          // Try to parse Gemini's "retry in XX.XXs" format
          const match = error.message.match(/retry in ([\d.]+)s/i);
          if (match) {
            retryDelayMs = Math.ceil(parseFloat(match[1]) * 1000);
          }
        }

        console.log(`[${jobId}] Consolidation attempt ${consolidationAttempt} failed. Retrying in ${retryDelayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }

    if (!finalTimestamps) {
      throw new Error('Consolidation failed after all retries');
    }

    console.log(`[${jobId}] Consolidation complete. Job finished successfully.`);
    setResult(jobId, finalTimestamps);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${jobId}] Fatal error:`, errorMessage);
    setError(jobId, errorMessage);
  }
}

