import { z } from 'zod';

// ============================================================================
// Configuration Types
// ============================================================================

export const MediaResolution = z.enum(['low', 'default']);
export type MediaResolution = z.infer<typeof MediaResolution>;

export const ProcessingConfigSchema = z.object({
  videoUrl: z.string().url(),
  chunkSize: z.number().min(5).max(60).default(25), // minutes
  fps: z.number().min(0.2).max(2.0).default(0.5),
  resolution: MediaResolution.default('low'),
  model: z.string().default('gemini-2.0-flash-exp'),
  concurrencyMode: z.enum(['adaptive', 'manual']).default('adaptive'),
  manualConcurrency: z.number().min(1).max(10).optional(),
});

export type ProcessingConfig = z.infer<typeof ProcessingConfigSchema>;

// ============================================================================
// Gemini API Types
// ============================================================================

export const ChunkEventSchema = z.object({
  timestamp: z.string().describe('HH:MM:SS format'),
  type: z.enum([
    'Main Topic',
    'Sub-topic',
    'Sponsor',
    'Merch',
    'Banter',
    'Technical',
    'Intro',
    'Outro',
    'Speaker Change',
    'Discussion Point',
  ]),
  title: z.string(),
  description: z.string(),
  visual_context: z.string().optional(),
  speaker: z.string().optional().describe('Name of speaker if identifiable'),
});

export type ChunkEvent = z.infer<typeof ChunkEventSchema>;

export const ChunkAnalysisSchema = z.object({
  chunk_summary: z.string().describe('Concise summary of the video segment'),
  events: z.array(ChunkEventSchema),
});

export type ChunkAnalysis = z.infer<typeof ChunkAnalysisSchema>;

// ============================================================================
// Job Management Types
// ============================================================================

export type JobStatus = 
  | 'pending'
  | 'processing'
  | 'consolidating'
  | 'completed'
  | 'failed';

export type ChunkStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'error'
  | 'retrying';

export interface ChunkMetadata {
  id: number;
  startOffset: string; // e.g., "0s"
  endOffset: string;   // e.g., "1500s"
  estimatedTokens: number;
  status: ChunkStatus;
  result?: ChunkAnalysis;
  error?: string;
  retryCount: number;
  processingTime?: number; // milliseconds
}

export interface JobLogEntry {
  timestamp: string; // ISO 8601
  level: 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface Job {
  id: string;
  status: JobStatus;
  config: ProcessingConfig;
  chunks: ChunkMetadata[];
  logs: JobLogEntry[];
  currentConcurrency: number;
  totalTokensUsed: number;
  retriesCount: number;
  startTime: string; // ISO 8601
  endTime?: string;  // ISO 8601
  result?: string;   // Final consolidated timestamp document
  error?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiKeyValidationResult {
  isValid: boolean;
  models?: string[];
  tier?: 'free' | 'paid' | 'unknown';
  tpm?: number; // Tokens per minute
  rpm?: number; // Requests per minute
  error?: string;
}

export interface JobCreationResult {
  jobId: string;
  estimatedChunks: number;
  estimatedTokens: number;
}

// ============================================================================
// SSE Event Types
// ============================================================================

export type SSEEventType =
  | 'job:status'
  | 'chunk:update'
  | 'concurrency:change'
  | 'log'
  | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}

export interface JobStatusEvent {
  type: 'job:status';
  data: {
    status: JobStatus;
    completedChunks: number;
    totalChunks: number;
    currentConcurrency: number;
    tokensUsed: number;
    eta?: number; // seconds
  };
}

export interface ChunkUpdateEvent {
  type: 'chunk:update';
  data: {
    chunkId: number;
    status: ChunkStatus;
    result?: ChunkAnalysis;
    error?: string;
    processingTime?: number;
  };
}

export interface ConcurrencyChangeEvent {
  type: 'concurrency:change';
  data: {
    from: number;
    to: number;
    reason: string;
  };
}

export interface LogEvent {
  type: 'log';
  data: JobLogEntry;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface StoredApiKey {
  key: string;
  hash: string;
  tier: 'free' | 'paid' | 'unknown';
  models: string[];
  expiresAt?: string; // ISO 8601
}

export interface CustomPrompt {
  content: string;
  modifiedAt: string; // ISO 8601
}

export interface StorageSchema {
  apiKey?: StoredApiKey;
  customPrompts?: Record<string, CustomPrompt>; // keyed by `${apiKeyHash}_${promptType}`
}

// ============================================================================
// Utility Types
// ============================================================================

export interface TokenCalculation {
  tokensPerSecond: number;
  tokensPerChunk: number;
  chunksPerMinute: number;
  withinLimit: boolean;
  warningMessage?: string;
}

