'use client';

/**
 * Main Application Component
 * Orchestrates the entire app flow:
 * 1. API key onboarding
 * 2. Input section
 * 3. Processing visualization
 * 4. Results display
 */

import { useState, useEffect } from 'react';
import { ApiKeyOnboarding } from './ApiKeyOnboarding';
import { InputSection } from './InputSection';
import { ProcessingView } from './ProcessingView';
import { ResultsView } from './ResultsView';
import { ApiKeyStorage } from '@/lib/storage';
import type { ApiKeyValidationResult } from '@/types';

type AppState = 'onboarding' | 'ready' | 'processing' | 'completed';

export function MainApp() {
  const [state, setState] = useState<AppState>('onboarding');
  const [apiKeyInfo, setApiKeyInfo] = useState<ApiKeyValidationResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  // Check for existing API key on mount
  useEffect(() => {
    const stored = ApiKeyStorage.get();
    if (stored) {
      setApiKeyInfo({
        isValid: true,
        tier: stored.tier,
        models: stored.models,
        tpm: stored.tier === 'paid' ? 4_000_000 : 250_000,
        rpm: stored.tier === 'paid' ? 360 : 15,
      });
      setState('ready');
    }
  }, []);

  const handleApiKeyValidated = (result: ApiKeyValidationResult) => {
    setApiKeyInfo(result);
    setState('ready');
  };

  const handleProcessingStarted = (newJobId: string) => {
    setJobId(newJobId);
    setState('processing');
  };

  const handleProcessingComplete = () => {
    setState('completed');
  };

  const handleStartNew = () => {
    setJobId(null);
    setState('ready');
  };

  // Render based on state
  if (state === 'onboarding') {
    return <ApiKeyOnboarding onSuccess={handleApiKeyValidated} />;
  }

  if (state === 'ready') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="mx-auto max-w-4xl space-y-6 py-8">
          <div className="space-y-2 text-center">
            <h1 className="text-4xl font-bold tracking-tight">YouTube Timestamp Generator</h1>
            <p className="text-muted-foreground">
              AI-powered timestamp generation using Gemini 2.5 Flash
            </p>
          </div>

          <InputSection apiKeyInfo={apiKeyInfo!} onStart={handleProcessingStarted} />
        </div>
      </div>
    );
  }

  if (state === 'processing' && jobId) {
    return <ProcessingView jobId={jobId} onComplete={handleProcessingComplete} />;
  }

  if (state === 'completed' && jobId) {
    return <ResultsView jobId={jobId} onStartNew={handleStartNew} />;
  }

  return null;
}
