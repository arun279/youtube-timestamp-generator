'use client';

/**
 * Input Section Component
 * Allows user to input YouTube URL and configure processing settings
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2, Play, Settings2, Youtube } from 'lucide-react';
import { useYouTubeDuration } from '@/hooks/use-youtube-duration';
import { createProcessingJob } from '@/app/actions/create-job';
import { ApiKeyStorage } from '@/lib/storage';
import { formatDuration, normalizeYouTubeUrl } from '@/lib/utils';
import type { ApiKeyValidationResult, ProcessingConfig } from '@/types';
import { TokenCalculator } from './TokenCalculator';
import { AdvancedSettings } from './AdvancedSettings';

interface InputSectionProps {
  apiKeyInfo: ApiKeyValidationResult;
  onStart: (jobId: string) => void;
}

export function InputSection({ apiKeyInfo, onStart }: InputSectionProps) {
  const [url, setUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Configuration state
  const [config, setConfig] = useState<Partial<ProcessingConfig>>({
    chunkSize: 25,
    fps: 0.5,
    resolution: 'low',
    model: 'gemini-2.5-flash',
    concurrencyMode: 'adaptive',
  });

  // Get video duration
  const {
    duration,
    title,
    loading: durationLoading,
    error: durationError,
  } = useYouTubeDuration(url);

  const handleStart = async () => {
    if (!url || !duration) return;

    setIsStarting(true);
    setError(null);

    try {
      const apiKey = ApiKeyStorage.getKey();
      if (!apiKey) {
        throw new Error('API key not found. Please re-enter your key.');
      }

      // Normalize URL to canonical form (strips query params like &t=)
      const normalizedUrl = normalizeYouTubeUrl(url);
      if (!normalizedUrl) {
        throw new Error('Invalid YouTube URL');
      }

      const fullConfig: ProcessingConfig = {
        videoUrl: normalizedUrl,
        chunkSize: config.chunkSize || 25,
        fps: config.fps || 0.5,
        resolution: config.resolution || 'low',
        model: config.model || 'gemini-2.0-flash-exp',
        concurrencyMode: config.concurrencyMode || 'adaptive',
      };

      const result = await createProcessingJob(fullConfig, apiKey, duration);
      onStart(result.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start processing');
    } finally {
      setIsStarting(false);
    }
  };

  const canStart = url && duration && !durationLoading && !isStarting;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Video Input</CardTitle>
        <CardDescription>Paste a YouTube URL to get started</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* URL Input */}
        <div className="space-y-2">
          <Label htmlFor="url">YouTube URL</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Youtube className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="url"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="pl-9"
                disabled={isStarting}
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowAdvanced(!showAdvanced)}
              disabled={isStarting}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Video Info */}
        {durationLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading video information...
          </div>
        )}

        {duration && title && (
          <div className="space-y-1 rounded-md bg-muted p-3">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">Duration: {formatDuration(duration)}</p>
          </div>
        )}

        {durationError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{durationError}</p>
          </div>
        )}

        {/* Advanced Settings */}
        {showAdvanced && duration && (
          <AdvancedSettings
            config={config}
            apiKeyInfo={apiKeyInfo}
            duration={duration}
            onChange={setConfig}
          />
        )}

        {/* Token Calculator */}
        {duration && (
          <TokenCalculator
            duration={duration}
            chunkSize={config.chunkSize || 25}
            fps={config.fps || 0.5}
            resolution={config.resolution || 'low'}
            tierLimit={apiKeyInfo.tpm || 250_000}
          />
        )}

        {/* Error Message */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Start Button */}
        <Button onClick={handleStart} disabled={!canStart} className="w-full" size="lg">
          {isStarting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Play className="h-5 w-5" />
              Generate Timestamps
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
