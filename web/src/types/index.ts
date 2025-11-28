import { z } from 'zod';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Media resolution options for video processing
 * Based on Gemini API MediaResolution enum
 *
 * Token counts per frame (Gemini 2.5):
 * - low: 64 tokens/frame
 * - medium: 256 tokens/frame
 * - high: 256 tokens/frame (same as medium for Gemini 2.5)
 *
 * Plus audio: 32 tokens/second always
 * @public Used for Zod validation and type inference
 */
export const MediaResolutionSchema = z.enum(['low', 'medium', 'high']);
export type MediaResolutionType = z.infer<typeof MediaResolutionSchema>;

export const Tier = z.enum(['free', 'tier1', 'tier2', 'tier3']);
export type Tier = z.infer<typeof Tier>;

export const ProcessingConfigSchema = z.object({
  videoUrl: z.string().url(),
  chunkSize: z.number().min(5).max(60).default(15), // minutes (reduced default for safety)
  fps: z.number().min(0.2).max(2).default(0.5),
  resolution: MediaResolutionSchema.default('low'),
  model: z.string().default('gemini-2.5-flash'),
  tier: Tier.default('free'),
  concurrencyMode: z.enum(['adaptive', 'manual']).default('adaptive'),
  manualConcurrency: z.number().min(1).max(10).optional(),
  /** Prompt pair ID - uses default if not specified */
  promptId: z.string().optional(),
});

export type ProcessingConfig = z.infer<typeof ProcessingConfigSchema>;

// ============================================================================
// Gemini API Types
// ============================================================================

const ChunkEventSchema = z.object({
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

export const ChunkAnalysisSchema = z.object({
  chunk_summary: z.string().describe('Concise summary of the video segment'),
  events: z.array(ChunkEventSchema),
});

export type ChunkAnalysis = z.infer<typeof ChunkAnalysisSchema>;

// ============================================================================
// Job Management Types
// ============================================================================

export type JobStatus = 'pending' | 'processing' | 'consolidating' | 'completed' | 'failed';

/** @public Valid chunk processing states */
export type ChunkStatus = 'pending' | 'processing' | 'completed' | 'error' | 'retrying';

export interface ChunkMetadata {
  id: number;
  startOffset: string; // e.g., "0s"
  endOffset: string; // e.g., "1500s"
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
  endTime?: string; // ISO 8601
  result?: string; // Final consolidated timestamp document
  error?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiKeyValidationResult {
  isValid: boolean;
  models?: string[];
  tier?: Tier;
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

/**
 * @public SSE event types - documents the Server-Sent Events protocol
 */
export type SSEEventType = 'job:status' | 'chunk:update' | 'concurrency:change' | 'log' | 'error';

/** @public Base SSE event shape */
export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}

/** @public Job status update event */
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

/** @public Chunk processing update event */
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

/** @public Concurrency change notification */
export interface ConcurrencyChangeEvent {
  type: 'concurrency:change';
  data: {
    from: number;
    to: number;
    reason: string;
  };
}

/** @public Log entry event */
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
  tier: Tier;
  models: string[];
  expiresAt?: string; // ISO 8601
}
