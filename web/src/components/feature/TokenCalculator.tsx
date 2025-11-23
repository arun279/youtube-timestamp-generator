'use client';

/**
 * Token Calculator Component
 * Shows estimated token usage and throughput
 */

import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, CheckCircle2, Zap } from 'lucide-react';
import { calculateTokens } from '@/lib/utils';

interface TokenCalculatorProps {
  duration: number; // seconds
  chunkSize: number; // minutes
  fps: number;
  resolution: 'low' | 'default';
  tierLimit: number; // TPM
}

export function TokenCalculator({
  duration,
  chunkSize,
  fps,
  resolution,
  tierLimit,
}: TokenCalculatorProps) {
  const stats = useMemo(() => {
    const chunkSizeSeconds = chunkSize * 60;
    const numChunks = Math.ceil(duration / chunkSizeSeconds);

    const { tokensPerSecond, totalTokens: tokensPerChunk } = calculateTokens(
      Math.min(chunkSizeSeconds, duration),
      fps,
      resolution
    );

    const totalTokens = calculateTokens(duration, fps, resolution).totalTokens;
    
    // Calculate max chunks per minute based on tier limit
    const chunksPerMinute = tierLimit / tokensPerChunk;
    
    // Check if within limits (use 80% safety margin)
    const withinLimit = tokensPerChunk < tierLimit * 0.8;

    return {
      tokensPerSecond: Math.round(tokensPerSecond),
      tokensPerChunk: Math.round(tokensPerChunk),
      totalTokens: Math.round(totalTokens),
      numChunks,
      chunksPerMinute: chunksPerMinute.toFixed(1),
      withinLimit,
    };
  }, [duration, chunkSize, fps, resolution, tierLimit]);

  return (
    <Card className={stats.withinLimit ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'}>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          {stats.withinLimit ? (
            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
          )}
          
          <div className="flex-1 space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">
                {stats.withinLimit ? 'Optimized Configuration' : 'Warning: High Token Usage'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="text-muted-foreground">Tokens/Chunk:</div>
              <div className="font-medium">
                ~{stats.tokensPerChunk.toLocaleString()}
              </div>

              <div className="text-muted-foreground">Total Tokens:</div>
              <div className="font-medium">
                ~{stats.totalTokens.toLocaleString()}
              </div>

              <div className="text-muted-foreground">Tier Limit:</div>
              <div className="font-medium">
                {tierLimit.toLocaleString()} TPM
              </div>

              <div className="text-muted-foreground">Chunks:</div>
              <div className="font-medium">
                {stats.numChunks}
              </div>

              <div className="text-muted-foreground flex items-center gap-1">
                <Zap className="w-3 h-3" />
                Throughput:
              </div>
              <div className="font-medium">
                ~{stats.chunksPerMinute} chunks/min
              </div>
            </div>

            {!stats.withinLimit && (
              <p className="text-xs text-yellow-700 mt-2">
                Consider reducing chunk size, FPS, or using low resolution to stay within limits
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

