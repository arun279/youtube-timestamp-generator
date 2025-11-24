/**
 * API Route: Get job status
 * Returns current state of a processing job
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob, getJobStats } from '@/lib/jobs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  console.warn(`[GET /api/jobs/${jobId}] Fetching job status`);

  const job = getJob(jobId);

  if (!job) {
    console.error(`[GET /api/jobs/${jobId}] Job not found`);
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  console.warn(`[GET /api/jobs/${jobId}] Job found, status: ${job.status}`);
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
