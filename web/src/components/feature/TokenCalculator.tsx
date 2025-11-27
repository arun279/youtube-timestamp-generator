'use client';

/**
 * Token Calculator Component
 * Shows estimated token usage and throughput with rate limit analysis
 *
 * Uses official Gemini API token rates:
 * https://ai.google.dev/gemini-api/docs/media-resolution
 */
import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Info, Zap } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { RATE_LIMIT_CONFIG, TOKEN_CONSTANTS } from '@/lib/constants';
import { getRateLimits, type Tier } from '@/lib/rate-limits';
import { calculateTokens } from '@/lib/utils';
import type { MediaResolutionType } from '@/types';

interface TokenCalculatorProps {
  duration: number; // seconds
  chunkSize: number; // minutes
  fps: number;
  resolution: MediaResolutionType;
  model: string;
  tier: Tier;
}

export function TokenCalculator({
  duration,
  chunkSize,
  fps,
  resolution,
  model,
  tier,
}: TokenCalculatorProps) {
  const stats = useMemo(() => {
    // Get rate limits for model and tier
    const limits = getRateLimits(model, tier);

    const chunkSizeSeconds = chunkSize * 60;
    const numChunks = Math.ceil(duration / chunkSizeSeconds);

    // Calculate tokens with breakdown
    const chunkDuration = Math.min(chunkSizeSeconds, duration);
    const {
      tokensPerSecond,
      totalTokens: tokensPerChunkRaw,
      breakdown,
    } = calculateTokens(chunkDuration, fps, resolution);

    // Apply safety multiplier (same as rate limiter uses)
    const safetyMultiplier = RATE_LIMIT_CONFIG.initialSafetyMultiplier;
    const tokensPerChunk = Math.ceil(tokensPerChunkRaw * safetyMultiplier);

    const { totalTokens: totalTokensRaw } = calculateTokens(duration, fps, resolution);
    const totalTokens = Math.ceil(totalTokensRaw * safetyMultiplier);

    // Calculate chunks per minute based on BOTH constraints
    const chunksPerMinuteTpm = limits.tpm / tokensPerChunk;
    const chunksPerMinuteRpm = limits.rpm;
    const chunksPerMinute = Math.min(chunksPerMinuteTpm, chunksPerMinuteRpm);

    // Determine bottleneck
    const bottleneck = chunksPerMinuteTpm < chunksPerMinuteRpm ? 'tpm' : 'rpm';

    // Check if single chunk exceeds TPM (impossible to process)
    const chunkExceedsLimit = tokensPerChunk > limits.tpm;

    // Chunk uses more than 80% of TPM limit
    const chunkNearLimit = tokensPerChunk > limits.tpm * 0.8;

    // Check if within reasonable limits
    const withinLimit = !chunkExceedsLimit && !chunkNearLimit;

    // Estimate processing time
    const estimatedMinutes = numChunks / chunksPerMinute;

    return {
      tokensPerSecond: Math.round(tokensPerSecond),
      tokensPerChunk,
      tokensPerChunkRaw,
      totalTokens,
      numChunks,
      chunksPerMinute: chunksPerMinute.toFixed(1),
      chunksPerMinuteTpm: chunksPerMinuteTpm.toFixed(1),
      chunksPerMinuteRpm: chunksPerMinuteRpm.toFixed(0),
      bottleneck,
      withinLimit,
      chunkExceedsLimit,
      chunkNearLimit,
      estimatedMinutes: estimatedMinutes.toFixed(1),
      limits,
      breakdown,
      safetyMultiplier,
    };
  }, [duration, chunkSize, fps, resolution, model, tier]);

  return (
    <Card
      className={
        stats.chunkExceedsLimit
          ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950'
          : stats.withinLimit
            ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950'
            : 'border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950'
      }
    >
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          {stats.chunkExceedsLimit ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          ) : stats.withinLimit ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600" />
          )}

          <div className="flex-1 space-y-3">
            {/* Status Header */}
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">
                {stats.chunkExceedsLimit
                  ? '❌ Chunk Exceeds Rate Limit'
                  : stats.withinLimit
                    ? '✓ Configuration OK'
                    : '⚠️ High Token Usage'}
              </span>
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="text-muted-foreground">Tokens/Chunk:</div>
              <div className="font-medium">
                ~{stats.tokensPerChunk.toLocaleString()}
                <span className="ml-1 text-muted-foreground">
                  (+{Math.round((stats.safetyMultiplier - 1) * 100)}% buffer)
                </span>
              </div>

              <div className="text-muted-foreground">Total Tokens:</div>
              <div className="font-medium">~{stats.totalTokens.toLocaleString()}</div>

              <div className="text-muted-foreground">TPM Limit:</div>
              <div className="font-medium">{stats.limits.tpm.toLocaleString()}</div>

              <div className="text-muted-foreground">RPM Limit:</div>
              <div className="font-medium">{stats.limits.rpm}</div>

              <div className="text-muted-foreground">Chunks:</div>
              <div className="font-medium">{stats.numChunks}</div>

              <div className="flex items-center gap-1 text-muted-foreground">
                <Zap className="h-3 w-3" />
                Bottleneck:
              </div>
              <div className="font-medium">
                {stats.bottleneck.toUpperCase()}{' '}
                <span className="text-muted-foreground">
                  (
                  {stats.bottleneck === 'tpm' ? stats.chunksPerMinuteTpm : stats.chunksPerMinuteRpm}{' '}
                  chunks/min)
                </span>
              </div>

              <div className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" />
                Est. Time:
              </div>
              <div className="font-medium">~{stats.estimatedMinutes} min</div>
            </div>

            {/* Calculation Methodology */}
            <div className="rounded border border-dashed border-muted-foreground/30 bg-muted/30 p-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Info className="h-3 w-3" />
                <span className="font-medium">Estimation Formula</span>
              </div>
              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                <p>
                  Video: {fps.toFixed(1)} FPS × {stats.breakdown.tokensPerFrame} tokens/frame ={' '}
                  {Math.round(stats.breakdown.videoTokensPerSecond)} tokens/s
                </p>
                <p>Audio: {TOKEN_CONSTANTS.audioTokensPerSecond} tokens/s (always included)</p>
                <p className="font-medium">
                  Total: {stats.tokensPerSecond} tokens/s × {chunkSize} min ={' '}
                  {stats.tokensPerChunkRaw.toLocaleString()} tokens/chunk
                </p>
              </div>
              <p className="mt-1 text-xs italic text-muted-foreground/70">
                Note: Actual usage may vary ±20%. The system adapts during processing.
              </p>
            </div>

            {/* Error/Warning Messages */}
            {stats.chunkExceedsLimit && (
              <div className="rounded bg-red-100 p-2 text-xs text-red-700 dark:bg-red-900/50 dark:text-red-300">
                <strong>Cannot process:</strong> A single chunk (
                {stats.tokensPerChunk.toLocaleString()} tokens) exceeds your TPM limit (
                {stats.limits.tpm.toLocaleString()}). Reduce chunk size, lower FPS, or use Low
                resolution.
              </div>
            )}

            {stats.chunkNearLimit && !stats.chunkExceedsLimit && (
              <div className="rounded bg-yellow-100 p-2 text-xs text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300">
                <strong>Slow processing:</strong> Chunks use {'>'}80% of TPM limit. Processing will
                be heavily throttled. Consider smaller chunks or lower settings.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
