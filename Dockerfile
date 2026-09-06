# syntax=docker/dockerfile:1

###############################################################################
# CFO Sentinel — production images (Next.js standalone output)
#
# Build: `docker compose up --build` (two targets):
#   - `runner`  — slim Next.js standalone server (the `app` service)
#   - `migrate` — full-tooling one-shot image (migrate deploy + db seed)
#
# The standalone trace from `next build` already bundles Node dependencies
# required at runtime, so the runner only adds Prisma's generated client +
# engine. Migrations/seeding need the prisma CLI + tsx, so they run from a
# separate target built on the full `deps` stage.
###############################################################################

# -----------------------------------------------------------------------------
# deps — install all dependencies (Prisma client generated here)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Prisma's schema/query engines need OpenSSL on musl (Alpine).
RUN apk add --no-cache openssl libc6-compat

# Leverage Docker layer caching by copying manifests first.
COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci

# -----------------------------------------------------------------------------
# builder — build the Next.js standalone output
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Prisma CLI runs here too (generate); musl needs OpenSSL.
RUN apk add --no-cache openssl libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js serves static files from /public; ensure the dir exists even when
# the repo ships no static assets (COPY of a missing dir fails).
RUN mkdir -p public

# Pre-generate the Prisma client so the typecheck/build have it available.
RUN npx prisma generate

# The standalone output copies only the minimal set of files (server code +
# required node_modules). `.env` is injected at runtime via Docker Compose.
RUN npm run build

# -----------------------------------------------------------------------------
# runner — minimal runtime image (the `app` service)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Prisma client needs OpenSSL at runtime for the query engine (musl/Alpine).
RUN apk add --no-cache openssl libc6-compat

# Non-root user for the runtime.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Prisma needs its generated client + engine at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Next.js standalone trace (server + traced node_modules).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets + generated client for the standalone server.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]

# -----------------------------------------------------------------------------
# migrate — one-shot image with the full CLI toolchain (migrate + seed)
# The `app` service depends on this completing successfully. NOT a server:
# it exits 0 after `prisma migrate deploy` + `prisma db seed`.
# -----------------------------------------------------------------------------
FROM deps AS migrate
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY . .

RUN npx prisma generate

CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]