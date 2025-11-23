'use server';

/**
 * Server Action: Create a processing job
 * Validates input, creates job, triggers background processing
 */

import { createJob, initializeJobCleanup } from '@/lib/jobs';
import { generateChunks } from '@/lib/utils';
import { ProcessingConfigSchema } from '@/types';
import type { JobCreationResult } from '@/types';
import { v4 as uuidv4 } from 'uuid';

// Initialize cleanup on module load
initializeJobCleanup();

export async function createProcessingJob(
  config: unknown,
  apiKey: string,
  videoDuration: number
): Promise<JobCreationResult> {
  try {
    // Validate config
    const validatedConfig = ProcessingConfigSchema.parse(config);

    // Generate chunks based on config
    const chunks = generateChunks(
      videoDuration,
      validatedConfig.chunkSize,
      validatedConfig.fps,
      validatedConfig.resolution
    );

    // Calculate total estimated tokens
    const estimatedTokens = chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0);

    // Create job ID
    const jobId = uuidv4();

    // Create job in store
    createJob(jobId, validatedConfig, chunks);

    // Log for debugging
    console.log(`[createProcessingJob] Created job ${jobId} with ${chunks.length} chunks`);

    // Import and call the background processing function directly
    // This avoids the fetch() issue in standalone builds
    import('@/lib/process-video').then(async (module) => {
      try {
        console.log(`[createProcessingJob] Starting background processing for job ${jobId}`);
        // Call the background processing directly
        await module.processVideoInBackground(jobId, apiKey);
      } catch (error) {
        console.error(`[createProcessingJob] Background processing error for job ${jobId}:`, error);
      }
    }).catch(error => {
      console.error(`[createProcessingJob] Failed to import process-video module:`, error);
    });

    return {
      jobId,
      estimatedChunks: chunks.length,
      estimatedTokens,
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to create job: ${error.message}`);
    }
    throw new Error('Failed to create job: Unknown error');
  }
}

