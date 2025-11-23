'use client';

/**
 * API Key Onboarding Component
 * Shows when user doesn't have a valid API key stored
 * Handles validation and storage
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, CheckCircle2, ExternalLink, Key, Loader2 } from 'lucide-react';
import { validateApiKey } from '@/app/actions/validate-key';
import { ApiKeyStorage } from '@/lib/storage';
import type { ApiKeyValidationResult } from '@/types';

interface ApiKeyOnboardingProps {
  onSuccess: (result: ApiKeyValidationResult) => void;
}

export function ApiKeyOnboarding({ onSuccess }: ApiKeyOnboardingProps) {
  const [apiKey, setApiKey] = useState('');
  const [persist, setPersist] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleValidate = async () => {
    if (!apiKey.trim()) {
      setError('Please enter your API key');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const result = await validateApiKey(apiKey.trim());

      if (result.isValid) {
        // Save to storage
        await ApiKeyStorage.save(apiKey.trim(), persist, {
          tier: result.tier || 'unknown',
          models: result.models || [],
        });

        onSuccess(result);
      } else {
        setError(result.error || 'API key validation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isValidating) {
      handleValidate();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-blue-50 to-indigo-100">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Key className="w-6 h-6 text-primary" />
            <CardTitle className="text-2xl">Welcome</CardTitle>
          </div>
          <CardDescription>
            Enter your Gemini API key to get started
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* API Key Input */}
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="AIza..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isValidating}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Your API key is stored locally and never sent to our servers
            </p>
          </div>

          {/* Remember Key Checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="persist"
              checked={persist}
              onCheckedChange={(checked) => setPersist(checked === true)}
              disabled={isValidating}
            />
            <Label
              htmlFor="persist"
              className="text-sm font-normal cursor-pointer"
            >
              Remember this key (store in localStorage)
            </Label>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Validate Button */}
          <Button
            onClick={handleValidate}
            disabled={isValidating || !apiKey.trim()}
            className="w-full"
          >
            {isValidating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Validating...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Validate & Continue
              </>
            )}
          </Button>

          {/* Help Text */}
          <div className="pt-4 border-t space-y-2">
            <p className="text-sm text-muted-foreground">
              Don&apos;t have a key?
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              asChild
            >
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get a free API key from AI Studio
                <ExternalLink className="w-3 h-3" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

