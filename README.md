# YouTube Timestamp Generator

AI-powered tool to generate detailed, accurate timestamps for YouTube videos using Google's Gemini 2.5 Flash API.

## Features

- 🎯 **Accurate Timestamps**: Chunks videos intelligently with absolute timestamp generation
- ⚡ **Dynamic Rate Limiting**: AIMD algorithm adapts to API limits automatically
- 🔒 **BYOK (Bring Your Own Key)**: Client-side API key storage (sessionStorage/localStorage), no server-side data storage
- 📊 **Real-time Progress**: Live updates via Server-Sent Events
- 🎨 **Modern UI**: Built with Next.js 15, Tailwind CSS, and shadcn/ui
- 🐳 **Docker-First**: Single command to run, zero local installs required

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Gemini API Key ([Get one free](https://aistudio.google.com/app/apikey))

### Run the Application

```bash
# Clone the repository
git clone <your-repo-url>
cd youtube-timestamp-generator

# Start the app
docker compose up

# Open browser to http://localhost:3000
```

**First build**: 3-5 minutes (downloads dependencies, builds Next.js)  
**Subsequent runs**: ~10 seconds (cached layers)

### Stop the Application

```bash
docker compose down
```

## Usage

### 1. Enter API Key (First Time)

On first launch, you'll see an onboarding screen:
- Paste your Gemini API key
- Optionally check "Remember this key" to persist in localStorage
- Keys are validated server-side before use

### 2. Generate Timestamps

1. **Paste YouTube URL** - any public YouTube video
2. **Wait for duration to load** - automatic via YouTube IFrame API
3. **Configure settings** (optional) - click ⚙️ to adjust:
   - Media Resolution: Low (98 tokens/sec) or Default (258 tokens/sec)
   - FPS: 0.2 - 2.0 (default: 0.5)
   - Chunk Size: 5-60 minutes (default: 25)
   - Concurrency Mode: Adaptive (recommended) or Manual
4. **Review token estimate** - live calculator warns if exceeding limits
5. **Click "Generate Timestamps"**

### 3. Monitor Progress

Real-time updates via Server-Sent Events:
- **Concurrency**: Current parallel API requests (adjusts automatically)
- **Tokens Used**: Running count towards rate limits
- **Chunks**: Visual grid showing status (pending → processing → completed)
- **Live Log**: Detailed event stream with timestamps

### 4. Export Results

When processing completes:
- **Copy to Clipboard**: One-click copy button
- **Download as .txt**: Save to local file
- **Process Another**: Start a new video

## How It Works

### Architecture

```
┌─────────────┐
│   Browser   │  ← React UI (sessionStorage for API keys)
└──────┬──────┘
       │ Server Actions (validation, job creation)
       │ SSE (real-time updates)
       ↓
┌──────────────────────────────────┐
│   Next.js Server (Docker)        │
│                                  │
│  ┌──────────┐   ┌─────────────┐ │
│  │  Server  │   │ API Routes  │ │
│  │ Actions  │   │ (Background)│ │
│  └────┬─────┘   └──────┬──────┘ │
│       │                │         │
│       │    ┌───────────▼──────┐  │
│       │    │  AIMD Queue      │  │
│       │    │ (Rate Limiter)   │  │
│       │    └───────────┬──────┘  │
│       │                │         │
│       └────────────────┘         │
│                │                 │
└────────────────┼─────────────────┘
                 ↓
        ┌────────────────┐
        │ Gemini 2.5 API │
        └────────────────┘
```

### Processing Pipeline

1. **Chunking**: Video divided into 25-minute segments (configurable)
   - Each chunk processed with `startOffset`, `endOffset`, and `fps` metadata
   - Gemini receives only the specific segment, not full video

2. **Analysis** (Parallel): Each chunk analyzed independently
   - AIMD queue manages concurrency (starts at 1, increases on success)
   - Structured output ensures valid JSON
   - Absolute timestamps calculated: `chunk_start + event_offset`
   - Retries on failures with exponential backoff

3. **Consolidation**: All chunk results merged
   - Deduplicates events across chunk boundaries
   - Sorts chronologically (strict timestamp order)
   - Formats per style guide (Main Topics, Sub-points, Sponsors, Merch)

4. **Output**: Formatted timestamp document
   ```
   [0:00] Chapters.
   [1:42] Intro.
   [2:13] Topic #1: Main topic title.
      > 5:30 Specific sub-point or detail.
      > 7:45 Another sub-point.
   [9:18] Topic #2: Next main topic.
   ```

## Configuration

### Default Settings (Optimized for Free Tier)

- **Chunk Size**: 25 minutes (~73,500 tokens/chunk)
- **Media Resolution**: Low (98 tokens/second)
- **FPS**: 0.5 (1 frame every 2 seconds)
- **Concurrency**: Adaptive (starts at 1, increases to tier max)
- **Free Tier Throughput**: ~3.4 chunks/minute (250K TPM ÷ 73.5K)

### Environment Variables (Optional)

For self-hosting with a shared API key, create a `.env` file:

```bash
GEMINI_API_KEY=AIza...
NODE_ENV=production
PORT=3000
```

Or use docker-compose:

```yaml
services:
  web:
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
```

### Rate Limits (Free Tier)

- **TPM**: 250,000 tokens per minute
- **RPM**: 15 requests per minute
- **RPD**: 250 requests per day

> **For more details, see the official Gemini API Rate Limits documentation: [https://ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits)**

The app automatically:
- Detects rate limits (429 errors)
- Reduces concurrency (multiplicative decrease)
- Respects `Retry-After` headers
- Resumes when window resets

## Prompts

Two prompts power the AI analysis:

### 1. Chunk Analysis (`prompts/chunk_analysis_prompt.md`)

Analyzes individual video chunks:
- Extracts events with timestamps, types, titles, descriptions
- Uses `{{CHUNK_START_OFFSET}}` to calculate absolute timestamps
- Outputs structured JSON (validated with Zod schema)

### 2. Consolidation (`prompts/consolidation_prompt.md`)

Merges chunk results into final document:
- Deduplicates across boundaries
- Maintains strict chronological order
- Formats hierarchically (Main Topics → Sub-points)
- Applies style rules (e.g., group all Sponsors, number Topics)

You can customize prompts by editing the markdown files in `prompts/`. Changes take effect on next Docker build.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **UI**: React 19, Tailwind CSS, shadcn/ui
- **State**: TanStack Query (React Query)
- **Queue**: p-queue + custom AIMD logic
- **API**: Google Gemini 2.5 Flash
- **Schema Validation**: Zod (Structured Outputs)
- **Container**: Docker (multi-stage Alpine build)
- **Real-time**: Server-Sent Events (SSE)

## Project Structure

```
.
├── docker-compose.yml      # Single-command startup
├── Dockerfile              # Multi-stage production build
├── prompts/                # AI prompts (committed)
│   ├── chunk_analysis_prompt.md
│   └── consolidation_prompt.md
└── web/                    # Next.js application
    ├── src/
    │   ├── app/
    │   │   ├── actions/    # Server Actions (API key, job creation)
    │   │   ├── api/        # API Routes (SSE, background processing)
    │   │   ├── page.tsx    # Main UI
    │   │   └── layout.tsx
    │   ├── components/
    │   │   ├── feature/    # Main components
    │   │   └── ui/         # shadcn components
    │   ├── lib/
    │   │   ├── gemini.ts   # Gemini API client
    │   │   ├── queue.ts    # AIMD rate limiter
    │   │   ├── jobs.ts     # In-memory job manager
    │   │   └── process-video.ts  # Main processing logic
    │   ├── hooks/          # Custom React hooks
    │   └── types/          # TypeScript types
    ├── scripts/
    │   └── load-prompts.ts # Converts prompts to TypeScript
    └── package.json
```

## Development

### Development Mode (Hot Reload)

```bash
docker compose watch
```

Changes sync automatically without rebuild.

### Add NPM Package

```bash
docker compose run --rm web npm install <package-name>
docker compose build  # Rebuild image
```

### View Logs

```bash
docker compose logs -f web
```

### Access Container Shell

```bash
docker compose exec web sh
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs web

# Rebuild from scratch
docker compose down
docker compose build --no-cache
docker compose up
```

### API Key Invalid

- Verify key starts with `AIza`
- Check quota at [AI Studio](https://aistudio.google.com/)
- Ensure container has internet access

### Rate Limits

The app handles rate limits automatically:
- AIMD algorithm adjusts concurrency
- Respects `Retry-After` delays
- UI shows current status

If persistent:
- Lower FPS (reduces tokens per chunk)
- Increase chunk size (fewer API calls)
- Check remaining quota in AI Studio

> For details on official Gemini API rate limits, see: [https://ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits)

### Port 3000 Already in Use

Edit `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"  # Use port 8080 instead
```

### Timestamps Out of Order

This was a known issue and has been fixed:
- Chunk analysis now uses absolute timestamps
- Consolidation enforces strict chronological sorting
- If you still see issues, rebuild: `docker compose build --no-cache`

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

- **Issues**: Open a GitHub issue
- **Questions**: Use GitHub Discussions
