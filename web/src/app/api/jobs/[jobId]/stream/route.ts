/**
 * API Route: SSE stream for real-time job updates
 * Provides Server-Sent Events for live progress tracking
 */

import { NextRequest } from 'next/server';
import { getJob, getJobStats } from '@/lib/jobs';
import { SSE_CONFIG } from '@/lib/constants';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  console.log(`[GET /api/jobs/${jobId}/stream] SSE connection initiated`);

  const job = getJob(jobId);
  
  if (!job) {
    console.error(`[GET /api/jobs/${jobId}/stream] Job not found`);
    return new Response('Job not found', { status: 404 });
  }

  console.log(`[GET /api/jobs/${jobId}/stream] Job found, starting SSE stream`);

  // Create readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      // Send initial state
      const sendUpdate = () => {
        const currentJob = getJob(jobId);
        if (!currentJob) {
          controller.close();
          return false;
        }

        const stats = getJobStats(jobId);
        
        const event = {
          type: 'job:status',
          data: {
            status: currentJob.status,
            completedChunks: stats?.completed || 0,
            totalChunks: currentJob.chunks.length,
            currentConcurrency: currentJob.currentConcurrency,
            tokensUsed: currentJob.totalTokensUsed,
            logs: currentJob.logs.slice(-50), // Last 50 logs
          },
        };

        const message = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(message));

        // Close stream if job is complete or failed
        if (currentJob.status === 'completed' || currentJob.status === 'failed') {
          controller.close();
          return false;
        }

        return true;
      };

      // Send initial update
      sendUpdate();

      // Poll for updates every 2 seconds
      const interval = setInterval(() => {
        if (!sendUpdate()) {
          clearInterval(interval);
        }
      }, 2000);

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        const comment = `: heartbeat\n\n`;
        try {
          controller.enqueue(encoder.encode(comment));
        } catch {
          clearInterval(heartbeat);
          clearInterval(interval);
        }
      }, SSE_CONFIG.heartbeatInterval);

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

