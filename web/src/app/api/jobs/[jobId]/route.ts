/**
 * API Route: Get job status
 * Returns current state of a processing job
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob, getJobStats } from '@/lib/jobs';
import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  logger.debug('API', 'Fetching job status', { jobId });

  const job = getJob(jobId);

  if (!job) {
    logger.warn('API', 'Job not found', { jobId });
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  logger.debug('API', 'Job found', { jobId, status: job.status });
  const stats = getJobStats(jobId);

  return NextResponse.json({
    ...job,
    stats,
    // Don't send API key back to client
    config: {
      ...job.config,
      apiKey: undefined,
    },
  });
}
