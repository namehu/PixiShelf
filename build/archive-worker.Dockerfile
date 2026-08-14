# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder

ARG PNPM_VERSION=8.15.1
ARG REGISTRY_URL=https://registry.npmmirror.com

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /workspace

RUN apk add --no-cache openssl ffmpeg \
    && npm install -g pnpm@${PNPM_VERSION} \
    && pnpm config set registry ${REGISTRY_URL} \
    && pnpm config set store-dir /pnpm/store

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/pixishelf/package.json ./packages/pixishelf/package.json
COPY packages/pixishelf-db/package.json ./packages/pixishelf-db/package.json
COPY packages/pixishelf-job-contracts/package.json ./packages/pixishelf-job-contracts/package.json
COPY packages/pixishelf-archive-worker/package.json ./packages/pixishelf-archive-worker/package.json

RUN --mount=type=cache,id=pnpm-archive-worker,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @pixishelf/archive-worker...

COPY packages/pixishelf ./packages/pixishelf
COPY packages/pixishelf-db ./packages/pixishelf-db
COPY packages/pixishelf-job-contracts ./packages/pixishelf-job-contracts
COPY packages/pixishelf-archive-worker ./packages/pixishelf-archive-worker

RUN pnpm --filter @pixishelf/db db:generate \
    && pnpm --filter @pixishelf/job-contracts build \
    && pnpm --filter @pixishelf/archive-worker build \
    && pnpm --filter @pixishelf/archive-worker deploy --prod /archive-worker-runtime \
    && generated_client="$(find /workspace/node_modules/.pnpm -path '*/node_modules/.prisma/client' -type d -print -quit)" \
    && deployed_client="$(find /archive-worker-runtime/node_modules/.pnpm -path '*/node_modules/.prisma/client' -type d -print -quit)" \
    && test -n "$generated_client" \
    && test -n "$deployed_client" \
    && rm -rf "$deployed_client" \
    && cp -R "$generated_client" "$deployed_client"

FROM node:20-alpine AS production

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache openssl ffmpeg \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs archiveworker \
    && mkdir -p /app/logs \
    && chown -R archiveworker:nodejs /app

COPY --from=builder --chown=archiveworker:nodejs /archive-worker-runtime/package.json ./package.json
COPY --from=builder --chown=archiveworker:nodejs /archive-worker-runtime/node_modules ./node_modules
COPY --from=builder --chown=archiveworker:nodejs /archive-worker-runtime/dist ./dist

USER archiveworker

CMD ["node", "dist/archive-worker.cjs"]
