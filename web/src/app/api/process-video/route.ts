/**
 * API Route: Background video processing
 * Handles long-running Gemini API calls with AIMD queue
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs';
import { processVideoInBackground } from '@/lib/process-video';

export async function POST(request: NextRequest) {
  try {
    const { jobId, apiKey } = await request.json();

    if (!jobId || !apiKey) {
      return NextResponse.json({ error: 'Missing jobId or apiKey' }, { status: 400 });
    }

    // Get job from store
    const job = getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Start processing (don't await - run in background)
    processVideoInBackground(jobId, apiKey).catch((error) => {
      console.error(`[process-video] Error processing job ${jobId}:`, error);
    });

    return NextResponse.json({ success: true, jobId });
  } catch (error) {
    console.error('[process-video] Error:', error);
    return NextResponse.json({ error: 'Failed to start processing' }, { status: 500 });
  }
}
