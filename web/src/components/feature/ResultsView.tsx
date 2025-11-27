'use client';

/**
 * Results View Component
 * Displays final consolidated timestamps
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Download, Loader2, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import type { Job } from '@/types';

interface ResultsViewProps {
  jobId: string;
  onStartNew: () => void;
}

export function ResultsView({ jobId, onStartNew }: ResultsViewProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const fetchJob = async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`);
        if (response.ok) {
          const data = await response.json();
          setJob(data);
        }
      } catch {
        console.error('Error fetching job');
      } finally {
        setLoading(false);
      }
    };

    fetchJob();
  }, [jobId]);

  const handleCopy = async () => {
    if (!job?.result) return;

    try {
      await navigator.clipboard.writeText(job.result);
      toast({
        title: 'Copied!',
        description: 'Timestamps copied to clipboard',
      });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Could not copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  const handleDownload = () => {
    if (!job?.result) return;

    const blob = new Blob([job.result], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timestamps-${jobId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: 'Downloaded!',
      description: 'Timestamps saved to file',
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!job || !job.result) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>No Results</CardTitle>
            <CardDescription>Could not load job results</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={onStartNew} className="w-full">
              Start New Job
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="mx-auto max-w-4xl space-y-6 py-8">
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-8 w-8" />
            <h1 className="text-3xl font-bold tracking-tight">Complete!</h1>
          </div>
          <p className="text-muted-foreground">Your timestamps are ready</p>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold">{job.chunks.length}</div>
              <div className="text-xs text-muted-foreground">Chunks Processed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold">{job.totalTokensUsed.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Tokens Used</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold">{job.retriesCount}</div>
              <div className="text-xs text-muted-foreground">Retries</div>
            </CardContent>
          </Card>
        </div>

        {/* Results Card */}
        <Card>
          <CardHeader>
            <CardTitle>Final Timestamps</CardTitle>
            <CardDescription>Copy or download your generated timestamps</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={handleCopy} variant="outline" className="flex-1">
                <Copy className="h-4 w-4" />
                Copy to Clipboard
              </Button>
              <Button onClick={handleDownload} variant="outline" className="flex-1">
                <Download className="h-4 w-4" />
                Download .txt
              </Button>
            </div>

            {/* Timestamps Text */}
            <div className="relative">
              <pre className="max-h-[600px] overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted p-4 text-sm">
                {job.result}
              </pre>
            </div>

            {/* Start New */}
            <Button onClick={onStartNew} className="w-full" size="lg">
              <RotateCcw className="h-5 w-5" />
              Process Another Video
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
