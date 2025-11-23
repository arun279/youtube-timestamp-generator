FROM node:20-alpine AS base

# Dependencies stage
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY web/package*.json ./
# Use npm install on first build (generates package-lock.json)
# Use --legacy-peer-deps to handle React 19 peer dependency issues
RUN npm install --legacy-peer-deps

# Builder stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY web/ .
COPY prompts/ /prompts/

# Generate prompts from /prompts directory
RUN npm run generate-prompts

# Build with standalone output
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built assets
COPY --from=builder /app/public ./public

# Standalone output includes everything needed
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

