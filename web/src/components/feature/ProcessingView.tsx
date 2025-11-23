'use client';

/**
 * Processing View Component
 * Shows real-time progress via SSE
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, Zap, Clock, Activity } from 'lucide-react';
import type { Job, JobLogEntry } from '@/types';

interface ProcessingViewProps {
  jobId: string;
  onComplete: () => void;
}

export function ProcessingView({ jobId, onComplete }: ProcessingViewProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [logs, setLogs] = useState<JobLogEntry[]>([]);

  useEffect(() => {
    // Fallback polling function
    const pollJob = async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`);
        if (response.ok) {
          const data = await response.json();
          setJob(data);
          setLogs(data.logs || []);
          
          if (data.status === 'completed') {
            onComplete();
          }
        }
      } catch (error) {
        console.error('Error polling job:', error);
      }
    };

    // Fetch initial job data before connecting to SSE
    pollJob();

    // Connect to SSE stream
    const eventSource = new EventSource(`/api/jobs/${jobId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'job:status') {
          // Poll full job data to get updated chunks array
          // SSE gives us basic stats, but we need full chunk details for UI
          pollJob();

          // Update logs immediately from SSE
          if (data.data.logs) {
            setLogs(data.data.logs);
          }

          // Check if complete
          if (data.data.status === 'completed' || data.data.status === 'failed') {
            eventSource.close();
            if (data.data.status === 'completed') {
              onComplete();
            }
          }
        }
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    };

    eventSource.onerror = () => {
      console.error('SSE connection error');
      eventSource.close();
      // Try polling as fallback
      pollJob();
    };

    // Cleanup
    return () => {
      eventSource.close();
    };
  }, [jobId, onComplete]);

  if (!job) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const completedChunks = job.chunks?.filter(c => c.status === 'completed').length || 0;
  const totalChunks = job.chunks?.length || 0;
  const progress = totalChunks > 0 ? (completedChunks / totalChunks) * 100 : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-6xl mx-auto space-y-6 py-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Processing Video
          </h1>
          <p className="text-muted-foreground">
            Real-time analysis with Gemini 2.5 Flash
          </p>
        </div>

        {/* Hero Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Activity className="w-5 h-5 text-blue-600" />
                <div>
                  <div className="text-2xl font-bold">{job.currentConcurrency}</div>
                  <div className="text-xs text-muted-foreground">Concurrency</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-yellow-600" />
                <div>
                  <div className="text-2xl font-bold">
                    {job.totalTokensUsed.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">Tokens Used</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-green-600" />
                <div>
                  <div className="text-2xl font-bold">
                    {completedChunks}/{totalChunks}
                  </div>
                  <div className="text-xs text-muted-foreground">Chunks</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
                <div>
                  <div className="text-2xl font-bold">{Math.round(progress)}%</div>
                  <div className="text-xs text-muted-foreground">Complete</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Progress Bar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Progress</CardTitle>
            <CardDescription>
              {job.status === 'processing' && 'Analyzing video chunks...'}
              {job.status === 'consolidating' && 'Consolidating results...'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progress} className="h-2" />
          </CardContent>
        </Card>

        {/* Chunk Grid */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Chunks</CardTitle>
            <CardDescription>Individual video segments</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
              {job.chunks.map((chunk) => (
                <div
                  key={chunk.id}
                  className={`aspect-square rounded-md flex items-center justify-center text-xs font-medium transition-all ${
                    chunk.status === 'completed'
                      ? 'bg-green-500 text-white'
                      : chunk.status === 'processing'
                      ? 'bg-blue-500 text-white animate-pulse'
                      : chunk.status === 'error'
                      ? 'bg-red-500 text-white'
                      : chunk.status === 'retrying'
                      ? 'bg-yellow-500 text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                  title={`Chunk ${chunk.id}: ${chunk.status}`}
                >
                  {chunk.id + 1}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Live Logs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Live Log</CardTitle>
            <CardDescription>Real-time processing events</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
              {logs.slice(-20).map((log, i) => (
                <div
                  key={i}
                  className={`py-1 px-2 rounded ${
                    log.level === 'error'
                      ? 'bg-red-50 text-red-700'
                      : log.level === 'warn'
                      ? 'bg-yellow-50 text-yellow-700'
                      : 'bg-gray-50 text-gray-700'
                  }`}
                >
                  <span className="text-muted-foreground">
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                  </span>{' '}
                  <span className="font-semibold uppercase">{log.level}</span>{' '}
                  {log.message}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

