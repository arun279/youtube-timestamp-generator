'use client';

/**
 * Input Section Component
 * Allows user to input YouTube URL and configure processing settings
 */
import { useState } from 'react';
import { AlertCircle, Loader2, Play, Settings2 } from 'lucide-react';

import { createProcessingJob } from '@/app/actions/create-job';
import { YouTubeIcon } from '@/components/icons/youtube';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useYouTubeDuration } from '@/hooks/use-youtube-duration';
import { DEFAULT_CONFIG } from '@/lib/constants';
import { ApiKeyStorage } from '@/lib/storage';
import { formatDuration, normalizeYouTubeUrl } from '@/lib/utils';
import type { ApiKeyValidationResult, ProcessingConfig } from '@/types';

import { AdvancedSettings } from './AdvancedSettings';
import { TokenCalculator } from './TokenCalculator';

interface InputSectionProps {
  readonly apiKeyInfo: ApiKeyValidationResult;
  readonly onStart: (jobId: string) => void;
}

export function InputSection({ apiKeyInfo, onStart }: InputSectionProps) {
  const [url, setUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Configuration state - defaults from constants (optimized for free tier)
  // promptId is undefined by default, which uses the default prompt
  const [config, setConfig] = useState<Partial<ProcessingConfig>>({
    chunkSize: DEFAULT_CONFIG.chunkSize,
    fps: DEFAULT_CONFIG.fps,
    resolution: DEFAULT_CONFIG.resolution,
    model: DEFAULT_CONFIG.model,
    tier: DEFAULT_CONFIG.tier,
    concurrencyMode: DEFAULT_CONFIG.concurrencyMode,
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
        chunkSize: config.chunkSize ?? DEFAULT_CONFIG.chunkSize,
        fps: config.fps ?? DEFAULT_CONFIG.fps,
        resolution: config.resolution ?? DEFAULT_CONFIG.resolution,
        model: config.model ?? DEFAULT_CONFIG.model,
        tier: config.tier ?? DEFAULT_CONFIG.tier,
        concurrencyMode: config.concurrencyMode ?? DEFAULT_CONFIG.concurrencyMode,
        promptId: config.promptId, // Pass through if set in advanced settings
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
              <YouTubeIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
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
            chunkSize={config.chunkSize ?? DEFAULT_CONFIG.chunkSize}
            fps={config.fps ?? DEFAULT_CONFIG.fps}
            resolution={config.resolution ?? DEFAULT_CONFIG.resolution}
            model={config.model ?? DEFAULT_CONFIG.model}
            tier={config.tier ?? DEFAULT_CONFIG.tier}
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
