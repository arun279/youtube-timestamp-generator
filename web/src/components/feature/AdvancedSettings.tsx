'use client';

/**
 * Advanced Settings Component
 * User-configurable processing options
 */

import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import type { ApiKeyValidationResult, ProcessingConfig } from '@/types';

interface AdvancedSettingsProps {
  config: Partial<ProcessingConfig>;
  apiKeyInfo: ApiKeyValidationResult;
  duration: number;
  onChange: (config: Partial<ProcessingConfig>) => void;
}

export function AdvancedSettings({
  config,
  apiKeyInfo,
  duration,
  onChange,
}: AdvancedSettingsProps) {
  const updateConfig = (updates: Partial<ProcessingConfig>) => {
    onChange({ ...config, ...updates });
  };

  return (
    <div className="space-y-4 p-4 border rounded-md bg-muted/30">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Advanced Settings</h3>
        <span className="text-xs text-muted-foreground">
          Tier: {apiKeyInfo.tier || 'unknown'}
        </span>
      </div>

      <Separator />

      {/* Media Resolution */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Media Resolution</Label>
        <div className="flex gap-2">
          <button
            onClick={() => updateConfig({ resolution: 'low' })}
            className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
              config.resolution === 'low'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input hover:bg-accent'
            }`}
          >
            Low (Fast)
            <span className="block text-xs opacity-70 mt-0.5">
              98 tokens/s
            </span>
          </button>
          <button
            onClick={() => updateConfig({ resolution: 'default' })}
            className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
              config.resolution === 'default'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input hover:bg-accent'
            }`}
          >
            Default (Quality)
            <span className="block text-xs opacity-70 mt-0.5">
              263 tokens/s
            </span>
          </button>
        </div>
      </div>

      {/* FPS Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Frames Per Second</Label>
          <span className="text-xs text-muted-foreground">
            {config.fps || 0.5} FPS
          </span>
        </div>
        <Slider
          value={[config.fps || 0.5]}
          onValueChange={([value]) => updateConfig({ fps: value })}
          min={0.2}
          max={2.0}
          step={0.1}
          className="py-4"
        />
        <p className="text-xs text-muted-foreground">
          Lower FPS = faster processing, less detail
        </p>
      </div>

      {/* Chunk Size Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Chunk Size</Label>
          <span className="text-xs text-muted-foreground">
            {config.chunkSize || 25} minutes
          </span>
        </div>
        <Slider
          value={[config.chunkSize || 25]}
          onValueChange={([value]) => updateConfig({ chunkSize: value })}
          min={5}
          max={60}
          step={5}
          className="py-4"
        />
        <p className="text-xs text-muted-foreground">
          Estimated chunks: {Math.ceil(duration / ((config.chunkSize || 25) * 60))}
        </p>
      </div>

      {/* Concurrency Mode */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Concurrency Mode</Label>
        <div className="flex gap-2">
          <button
            onClick={() => updateConfig({ concurrencyMode: 'adaptive' })}
            className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
              config.concurrencyMode === 'adaptive'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input hover:bg-accent'
            }`}
          >
            🤖 Adaptive
            <span className="block text-xs opacity-70 mt-0.5">
              Recommended
            </span>
          </button>
          <button
            onClick={() => updateConfig({ concurrencyMode: 'manual' })}
            className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
              config.concurrencyMode === 'manual'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input hover:bg-accent'
            }`}
          >
            🎛️ Manual
            <span className="block text-xs opacity-70 mt-0.5">
              Fixed rate
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

