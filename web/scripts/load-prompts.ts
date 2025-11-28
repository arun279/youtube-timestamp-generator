#!/usr/bin/env tsx
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build script: Load prompt pairs from /prompts subdirectories and generate registry.ts
 *
 * Directory structure expected:
 *   /prompts/{prompt-id}/
 *     ├── meta.json           (optional: { name, description, isDefault })
 *     ├── chunk_analysis.md
 *     └── consolidation.md
 *
 * This runs at build time to embed prompts into the application.
 * The generated registry provides a simple API for runtime access.
 */

/**
 * Resolve prompts directory, checking multiple locations:
 * 1. PROMPTS_DIR env var (explicit override)
 * 2. ../prompts (local development - running from web/)
 * 3. /prompts (Docker container)
 */
function resolvePromptsDir(): string {
  if (process.env.PROMPTS_DIR) {
    return process.env.PROMPTS_DIR;
  }

  // Try local development path first (running from web/)
  const localPath = join(process.cwd(), '..', 'prompts');
  if (existsSync(localPath)) {
    return localPath;
  }

  // Fall back to Docker path
  return '/prompts';
}

const PROMPTS_DIR = resolvePromptsDir();
const OUTPUT_DIR = join(process.cwd(), 'src', 'lib', 'prompts');
const OUTPUT_FILE = join(OUTPUT_DIR, 'registry.ts');

interface PromptMeta {
  name?: string;
  description?: string;
  isDefault?: boolean;
}

interface PromptPair {
  id: string;
  name: string;
  description?: string;
  chunkAnalysis: string;
  consolidation: string;
}

interface LoadedPromptPair extends PromptPair {
  isDefault: boolean;
}

interface LoadResult {
  prompts: PromptPair[];
  defaultId: string;
}

/**
 * Convert kebab-case to Title Case
 */
function toTitleCase(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Load a single prompt pair from a directory
 */
function loadPromptPair(promptId: string, promptDir: string): LoadedPromptPair {
  const chunkAnalysisPath = join(promptDir, 'chunk_analysis.md');
  const consolidationPath = join(promptDir, 'consolidation.md');
  const metaPath = join(promptDir, 'meta.json');

  // Validate required files exist
  if (!existsSync(chunkAnalysisPath)) {
    throw new Error(`Missing chunk_analysis.md in ${promptDir}`);
  }
  if (!existsSync(consolidationPath)) {
    throw new Error(`Missing consolidation.md in ${promptDir}`);
  }

  // Read prompt files
  const chunkAnalysis = readFileSync(chunkAnalysisPath, 'utf-8');
  const consolidation = readFileSync(consolidationPath, 'utf-8');

  // Read optional metadata
  let meta: PromptMeta = {};
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as PromptMeta;
    } catch (error) {
      console.warn(`[load-prompts] Warning: Failed to parse meta.json in ${promptDir}`, error);
    }
  }

  return {
    id: promptId,
    name: meta.name ?? toTitleCase(promptId),
    description: meta.description,
    chunkAnalysis,
    consolidation,
    isDefault: meta.isDefault ?? false,
  };
}

/**
 * Scan prompts directory and load all prompt pairs
 */
function loadAllPrompts(): LoadResult {
  console.warn('[load-prompts] Loading prompts from:', PROMPTS_DIR);

  if (!existsSync(PROMPTS_DIR)) {
    throw new Error(`Prompts directory not found: ${PROMPTS_DIR}`);
  }

  const entries = readdirSync(PROMPTS_DIR);
  const loadedPairs: LoadedPromptPair[] = [];
  let defaultId: string | undefined;

  for (const entry of entries) {
    const entryPath = join(PROMPTS_DIR, entry);

    // Skip files, only process directories
    if (!statSync(entryPath).isDirectory()) {
      continue;
    }

    console.warn(`[load-prompts] Loading prompt pair: ${entry}`);

    const pair = loadPromptPair(entry, entryPath);
    loadedPairs.push(pair);

    console.warn(`[load-prompts] ✓ ${pair.name}`);
    console.warn(`    chunk_analysis.md: ${pair.chunkAnalysis.length} chars`);
    console.warn(`    consolidation.md: ${pair.consolidation.length} chars`);

    // Check for default flag (already loaded from meta.json)
    if (pair.isDefault) {
      if (defaultId) {
        console.warn(`[load-prompts] Warning: Multiple defaults found. Using first: ${defaultId}`);
      } else {
        defaultId = entry;
      }
    }
  }

  if (loadedPairs.length === 0) {
    throw new Error('No prompt pairs found in prompts directory');
  }

  // Sort alphabetically for consistent output
  loadedPairs.sort((a, b) => a.id.localeCompare(b.id));

  // Use first prompt if no default specified
  // Note: loadedPairs.length > 0 is guaranteed by the check above
  if (!defaultId) {
    const firstPrompt = loadedPairs[0];
    if (!firstPrompt) {
      throw new Error('Unexpected: prompts array is empty after validation');
    }
    defaultId = firstPrompt.id;
    console.warn(`[load-prompts] No default specified, using: ${defaultId}`);
  }

  // Strip isDefault from output (not needed in runtime registry)
  const prompts: PromptPair[] = loadedPairs.map(
    (pair): PromptPair => ({
      id: pair.id,
      name: pair.name,
      description: pair.description,
      chunkAnalysis: pair.chunkAnalysis,
      consolidation: pair.consolidation,
    })
  );

  console.warn(`[load-prompts] Loaded ${prompts.length} prompt pair(s), default: ${defaultId}`);

  return { prompts, defaultId };
}

/**
 * Generate the TypeScript registry file
 */
function generateTypeScript(result: LoadResult): string {
  const { prompts, defaultId } = result;

  // Build the registry object
  const registryEntries = prompts
    .map((p) => {
      const descLine = p.description ? `\n    description: ${JSON.stringify(p.description)},` : '';
      return `  ${JSON.stringify(p.id)}: {
    id: ${JSON.stringify(p.id)},
    name: ${JSON.stringify(p.name)},${descLine}
    chunkAnalysis: ${JSON.stringify(p.chunkAnalysis)},
    consolidation: ${JSON.stringify(p.consolidation)},
  }`;
    })
    .join(',\n');

  return `// Auto-generated by scripts/load-prompts.ts
// DO NOT EDIT MANUALLY - Edit prompts/*/*.md instead

/**
 * A prompt pair contains the prompts for chunk analysis and consolidation.
 * Each pair is designed for a specific type of video content.
 * @public
 */
export interface PromptPair {
  /** Unique identifier (folder name) */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Optional description of what this prompt is optimized for */
  description?: string;
  /** Prompt for analyzing individual video chunks */
  chunkAnalysis: string;
  /** Prompt for consolidating chunk analyses into final timestamps */
  consolidation: string;
}

/**
 * Registry of all available prompt pairs.
 * Key is the prompt ID (folder name).
 * @public
 */
export const PROMPT_REGISTRY: Record<string, PromptPair> = {
${registryEntries},
} as const;

/**
 * The default prompt ID to use when none is specified.
 * @public
 */
export const DEFAULT_PROMPT_ID = ${JSON.stringify(defaultId)} as const;

/**
 * Get all available prompt pairs as an array.
 * Useful for populating UI selectors.
 * @public
 */
export function getPromptPairs(): PromptPair[] {
  return Object.values(PROMPT_REGISTRY);
}

/**
 * Get a specific prompt pair by ID.
 * Returns undefined if the ID doesn't exist.
 * @public
 */
export function getPromptPair(id: string): PromptPair | undefined {
  return PROMPT_REGISTRY[id];
}

/**
 * Get the default prompt pair.
 * Guaranteed to return a valid prompt pair.
 * @public
 */
export function getDefaultPromptPair(): PromptPair {
  // DEFAULT_PROMPT_ID is guaranteed to exist in the registry at build time
  return PROMPT_REGISTRY[DEFAULT_PROMPT_ID] as PromptPair;
}

/**
 * Get a prompt pair by ID, falling back to default if not found.
 * Use this when you want to ensure you always get a valid prompt.
 */
export function getPromptPairOrDefault(id?: string): PromptPair {
  if (id) {
    const prompt = PROMPT_REGISTRY[id];
    if (prompt) {
      return prompt;
    }
  }
  return getDefaultPromptPair();
}
`;
}

function main() {
  console.warn('[load-prompts] Starting prompt generation...');

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    console.warn('[load-prompts] Created output directory:', OUTPUT_DIR);
  }

  // Load all prompts
  const result = loadAllPrompts();

  // Generate TypeScript
  const typescript = generateTypeScript(result);

  // Write output
  writeFileSync(OUTPUT_FILE, typescript, 'utf-8');
  console.warn('[load-prompts] ✓ Generated:', OUTPUT_FILE);
  console.warn('[load-prompts] Done!');
}

main();
