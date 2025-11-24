/**
 * In-Memory Job Manager
 * Tracks processing jobs and their state
 * 
 * For MVP: Single-instance in-memory storage
 * For production: Replace with Redis for multi-instance support
 * 
 * IMPORTANT: In Next.js standalone mode, Server Actions and API Routes
 * may run in separate contexts. We use globalThis to ensure a single
 * shared instance across all runtime contexts.
 */

import type { Job, JobStatus, ChunkMetadata, JobLogEntry, ProcessingConfig } from '@/types';
import { JOB_CONFIG } from './constants';

// Ensure jobs Map is truly global across all Next.js runtime contexts
declare global {
  // eslint-disable-next-line no-var
  var __jobsStore: Map<string, Job> | undefined;
}

// Use globalThis to share the Map between Server Actions and API Routes
const jobs = globalThis.__jobsStore ?? new Map<string, Job>();
if (!globalThis.__jobsStore) {
  globalThis.__jobsStore = jobs;
  console.log('[jobs] Initialized global jobs store');
}

// Export for debugging
export { jobs };

// Cleanup interval
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Initialize job cleanup (call once on server startup)
 */
export function initializeJobCleanup(): void {
  if (cleanupInterval) return;
  
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    
    for (const [jobId, job] of jobs.entries()) {
      // Remove completed/failed jobs older than retention period
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        job.endTime
      ) {
        const endTime = new Date(job.endTime).getTime();
        if (now - endTime > JOB_CONFIG.retentionMs) {
          jobs.delete(jobId);
        }
      }
    }
  }, JOB_CONFIG.cleanupInterval);
}

/**
 * Create a new job
 */
export function createJob(
  id: string,
  config: ProcessingConfig,
  chunks: Omit<ChunkMetadata, 'status' | 'retryCount'>[]
): Job {
  const job: Job = {
    id,
    status: 'pending',
    config,
    chunks: chunks.map(chunk => ({
      ...chunk,
      status: 'pending',
      retryCount: 0,
    })),
    logs: [],
    currentConcurrency: 1,
    totalTokensUsed: 0,
    retriesCount: 0,
    startTime: new Date().toISOString(),
  };

  jobs.set(id, job);
  
  addLog(id, 'info', `Job created with ${chunks.length} chunks`);
  
  return job;
}

/**
 * Get a job by ID
 */
export function getJob(id: string): Job | undefined {
  const job = jobs.get(id);
  if (!job) {
    console.log(`[jobs.getJob] Job ${id} not found. Available jobs: ${Array.from(jobs.keys()).join(', ')}`);
  }
  return job;
}

/**
 * Update job status
 */
export function updateJobStatus(id: string, status: JobStatus): void {
  const job = jobs.get(id);
  if (!job) return;

  job.status = status;
  
  if (status === 'completed' || status === 'failed') {
    job.endTime = new Date().toISOString();
  }

  addLog(id, 'info', `Job status: ${status}`);
}

/**
 * Update chunk status
 */
export function updateChunkStatus(
  jobId: string,
  chunkId: number,
  status: ChunkMetadata['status'],
  result?: ChunkMetadata['result'],
  error?: string,
  processingTime?: number
): void {
  const job = jobs.get(jobId);
  if (!job) return;

  const chunk = job.chunks.find(c => c.id === chunkId);
  if (!chunk) return;

  chunk.status = status;
  
  if (result) {
    chunk.result = result;
  }
  
  if (error) {
    chunk.error = error;
  }
  
  if (processingTime) {
    chunk.processingTime = processingTime;
  }
  
  if (status === 'retrying') {
    chunk.retryCount++;
    job.retriesCount++;
  }

  const level = status === 'error' ? 'error' : 'info';
  addLog(jobId, level, `Chunk ${chunkId + 1}: ${status}`, {
    chunkId,
    status,
    retryCount: chunk.retryCount,
  });
}

/**
 * Update concurrency level
 */
export function updateConcurrency(jobId: string, concurrency: number): void {
  const job = jobs.get(jobId);
  if (!job) return;

  const oldConcurrency = job.currentConcurrency;
  job.currentConcurrency = concurrency;

  if (oldConcurrency !== concurrency) {
    addLog(jobId, 'info', `Concurrency: ${oldConcurrency} → ${concurrency}`);
  }
}

/**
 * Add tokens used
 */
export function addTokensUsed(jobId: string, tokens: number): void {
  const job = jobs.get(jobId);
  if (!job) return;

  job.totalTokensUsed += tokens;
}

/**
 * Set final result
 */
export function setResult(jobId: string, result: string): void {
  const job = jobs.get(jobId);
  if (!job) return;

  job.result = result;
  updateJobStatus(jobId, 'completed');
}

/**
 * Set error
 */
export function setError(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (!job) return;

  job.error = error;
  updateJobStatus(jobId, 'failed');
  addLog(jobId, 'error', error);
}

/**
 * Add a log entry
 */
export function addLog(
  jobId: string,
  level: JobLogEntry['level'],
  message: string,
  metadata?: Record<string, unknown>
): void {
  const job = jobs.get(jobId);
  if (!job) return;

  job.logs.push({
    timestamp: new Date().toISOString(),
    level,
    message,
    metadata,
  });

  // Keep only last 500 logs to prevent memory issues
  if (job.logs.length > 500) {
    job.logs = job.logs.slice(-500);
  }
}

/**
 * Get job statistics
 */
export function getJobStats(jobId: string): {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  error: number;
  retrying: number;
} | null {
  const job = jobs.get(jobId);
  if (!job) return null;

  return {
    total: job.chunks.length,
    pending: job.chunks.filter(c => c.status === 'pending').length,
    processing: job.chunks.filter(c => c.status === 'processing').length,
    completed: job.chunks.filter(c => c.status === 'completed').length,
    error: job.chunks.filter(c => c.status === 'error').length,
    retrying: job.chunks.filter(c => c.status === 'retrying').length,
  };
}

/**
 * Get all jobs (for debugging)
 */
export function getAllJobs(): Job[] {
  return Array.from(jobs.values());
}

/**
 * Delete a job
 */
export function deleteJob(id: string): void {
  jobs.delete(id);
}

/**
 * Clear all jobs (for testing)
 */
export function clearAllJobs(): void {
  jobs.clear();
}

