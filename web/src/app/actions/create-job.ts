'use server';

/**
 * Server Action: Create a processing job
 * Validates input, creates job, triggers background processing
 */
import { v4 as uuidv4 } from 'uuid';

import { createJob, initializeJobCleanup } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { generateChunks } from '@/lib/utils';
import { ProcessingConfigSchema, type JobCreationResult } from '@/types';

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
    logger.info('CreateJob', 'Job created', { jobId, chunkCount: chunks.length });

    // Import and call the background processing function directly
    // This avoids the fetch() issue in standalone builds
    import('@/lib/process-video')
      .then(async (module) => {
        try {
          logger.info('CreateJob', 'Starting background processing', { jobId });
          // Call the background processing directly
          await module.processVideoInBackground(jobId, apiKey);
        } catch (error) {
          logger.error('CreateJob', 'Background processing error', {
            jobId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })
      .catch((error) => {
        logger.error('CreateJob', 'Failed to import process-video module', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
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
