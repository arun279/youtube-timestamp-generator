'use client';

/**
 * Advanced Settings Component
 * User-configurable processing options
 *
 * Token rates are based on official Gemini API documentation:
 * https://ai.google.dev/gemini-api/docs/media-resolution
 */
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { TOKEN_CONSTANTS } from '@/lib/constants';
import { getPromptPairOrDefault, getPromptPairs } from '@/lib/prompts/registry';
import type { ApiKeyValidationResult, MediaResolutionType, ProcessingConfig } from '@/types';

interface AdvancedSettingsProps {
  readonly config: Partial<ProcessingConfig>;
  /** Reserved for future tier-specific UI enhancements */
  readonly apiKeyInfo?: ApiKeyValidationResult;
  readonly duration: number;
  readonly onChange: (config: Partial<ProcessingConfig>) => void;
}

// Resolution options with metadata from official docs
const RESOLUTION_OPTIONS: {
  value: MediaResolutionType;
  label: string;
  description: string;
  tokensPerFrame: number;
  recommended?: boolean;
}[] = [
  {
    value: 'low',
    label: 'Low',
    description: 'Fastest, lower detail',
    tokensPerFrame: TOKEN_CONSTANTS.tokensPerFrame.low,
    recommended: true,
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Balanced quality/speed',
    tokensPerFrame: TOKEN_CONSTANTS.tokensPerFrame.medium,
  },
  {
    value: 'high',
    label: 'High',
    description: 'Best quality, slower',
    tokensPerFrame: TOKEN_CONSTANTS.tokensPerFrame.high,
  },
];

export function AdvancedSettings({
  config,
  apiKeyInfo: _apiKeyInfo,
  duration,
  onChange,
}: AdvancedSettingsProps) {
  const updateConfig = (updates: Partial<ProcessingConfig>) => {
    onChange({ ...config, ...updates });
  };

  // Get available prompts and current selection
  const promptPairs = getPromptPairs();
  const currentPrompt = getPromptPairOrDefault(config.promptId);

  // Calculate tokens/second for current settings
  const currentFps = config.fps || 0.5;
  const currentResolution = config.resolution || 'low';
  const tokensPerFrame =
    RESOLUTION_OPTIONS.find((r) => r.value === currentResolution)?.tokensPerFrame ||
    TOKEN_CONSTANTS.tokensPerFrame.low;
  const tokensPerSecond = currentFps * tokensPerFrame + TOKEN_CONSTANTS.audioTokensPerSecond;

  return (
    <div className="space-y-4 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Advanced Settings</h3>
      </div>

      <Separator />

      {/* Prompt Template Selector */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Prompt Template</Label>
        <Select
          value={currentPrompt.id}
          onValueChange={(value: string) => updateConfig({ promptId: value })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a prompt template" />
          </SelectTrigger>
          <SelectContent>
            {promptPairs.map((prompt) => (
              <SelectItem key={prompt.id} value={prompt.id}>
                {prompt.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {currentPrompt.description && (
          <p className="text-xs text-muted-foreground">{currentPrompt.description}</p>
        )}
      </div>

      <Separator />

      {/* Tier Selection */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">API Tier</Label>
        <div className="grid grid-cols-4 gap-2">
          {(['free', 'tier1', 'tier2', 'tier3'] as const).map((tier) => (
            <button
              key={tier}
              onClick={() => updateConfig({ tier })}
              className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                config.tier === tier
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input hover:bg-accent'
              }`}
            >
              {tier === 'free' ? 'Free' : tier.replace('tier', 'Tier ')}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Free tier is default. Change if you have upgraded your API key.
        </p>
      </div>

      <Separator />

      {/* Media Resolution */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Media Resolution</Label>
        <div className="grid grid-cols-3 gap-2">
          {RESOLUTION_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => updateConfig({ resolution: option.value })}
              className={`rounded-md border px-3 py-2 text-xs transition-colors ${
                config.resolution === option.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input hover:bg-accent'
              }`}
            >
              <span className="font-medium">
                {option.label}
                {option.recommended && ' ✓'}
              </span>
              <span className="mt-0.5 block text-xs opacity-70">{option.description}</span>
              <span className="mt-0.5 block text-xs opacity-50">
                {option.tokensPerFrame} tokens/frame
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Higher resolution = better detail but more tokens and slower processing.
        </p>
      </div>

      {/* FPS Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Frames Per Second</Label>
          <span className="text-xs text-muted-foreground">{currentFps.toFixed(1)} FPS</span>
        </div>
        <Slider
          value={[currentFps]}
          onValueChange={([value]) => updateConfig({ fps: value })}
          min={0.2}
          max={2}
          step={0.1}
          className="py-4"
        />
        <p className="text-xs text-muted-foreground">
          Lower FPS = fewer frames analyzed, faster processing.
        </p>
      </div>

      {/* Chunk Size Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Chunk Size</Label>
          <span className="text-xs text-muted-foreground">{config.chunkSize || 15} minutes</span>
        </div>
        <Slider
          value={[config.chunkSize || 15]}
          onValueChange={([value]) => updateConfig({ chunkSize: value })}
          min={5}
          max={60}
          step={5}
          className="py-4"
        />
        <p className="text-xs text-muted-foreground">
          Chunks: {Math.ceil(duration / ((config.chunkSize || 15) * 60))} •{' '}
          {Math.round(tokensPerSecond * (config.chunkSize || 15) * 60).toLocaleString()}{' '}
          tokens/chunk
        </p>
      </div>

      {/* Token Calculation Explanation */}
      <div className="rounded-md bg-muted/50 p-3">
        <p className="text-xs font-medium text-muted-foreground">📊 Token Calculation</p>
        <p className="mt-1 text-xs text-muted-foreground">
          ({currentFps.toFixed(1)} FPS × {tokensPerFrame} tokens/frame) + 32 audio ={' '}
          <span className="font-medium">{Math.round(tokensPerSecond)} tokens/sec</span>
        </p>
        <p className="mt-1 text-xs italic text-muted-foreground">
          ⚠️ This is an estimate. Actual usage may vary by ±20%.
        </p>
      </div>

      <Separator />

      {/* Concurrency Mode */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Concurrency Mode</Label>
        <div className="flex gap-2">
          <button
            onClick={() => updateConfig({ concurrencyMode: 'adaptive' })}
            className={`flex-1 rounded-md border px-3 py-2 text-xs transition-colors ${
              config.concurrencyMode === 'adaptive'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input hover:bg-accent'
            }`}
          >
            <span>🤖 Adaptive</span>
            <span className="mt-0.5 block text-xs opacity-70">Recommended</span>
          </button>
          <button
            onClick={() => updateConfig({ concurrencyMode: 'manual' })}
            className={`flex-1 rounded-md border px-3 py-2 text-xs transition-colors ${
              config.concurrencyMode === 'manual'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input hover:bg-accent'
            }`}
          >
            <span>🎛️ Manual</span>
            <span className="mt-0.5 block text-xs opacity-70">Fixed rate</span>
          </button>
        </div>
      </div>
    </div>
  );
}
