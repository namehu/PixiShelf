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
COPY packages/pixishelf-db/package.json ./packages/pixishelf-db/package.json
COPY packages/pixishelf-job-contracts/package.json ./packages/pixishelf-job-contracts/package.json
COPY packages/pixishelf-job-executors/package.json ./packages/pixishelf-job-executors/package.json
COPY packages/pixishelf-job-runtime/package.json ./packages/pixishelf-job-runtime/package.json
COPY packages/pixishelf-worker/package.json ./packages/pixishelf-worker/package.json

RUN --mount=type=cache,id=pnpm-worker,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @pixishelf/worker...

COPY packages/pixishelf-db ./packages/pixishelf-db
COPY packages/pixishelf-job-contracts ./packages/pixishelf-job-contracts
COPY packages/pixishelf-job-executors ./packages/pixishelf-job-executors
COPY packages/pixishelf-job-runtime ./packages/pixishelf-job-runtime
COPY packages/pixishelf-worker ./packages/pixishelf-worker

RUN pnpm --filter @pixishelf/db db:generate \
    && pnpm --filter @pixishelf/worker... build \
    && pnpm --filter @pixishelf/worker deploy --prod /worker-runtime \
    && generated_client="$(find /workspace/node_modules/.pnpm -path '*/node_modules/.prisma/client' -type d -print -quit)" \
    && deployed_client="$(find /worker-runtime/node_modules/.pnpm -path '*/node_modules/.prisma/client' -type d -print -quit)" \
    && test -n "$generated_client" \
    && test -n "$deployed_client" \
    && rm -rf "$deployed_client" \
    && cp -R "$generated_client" "$deployed_client"

FROM node:20-alpine AS production

ENV NODE_ENV=production
ENV WORKER_HEALTH_HOST=0.0.0.0
ENV WORKER_HEALTH_PORT=3011

WORKDIR /app

RUN apk add --no-cache openssl ffmpeg tini \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs pixishelfworker \
    && mkdir -p /app/data /app/.local-data/derived-media /app/pixiv-data/tags /app/pixiv-data/artists \
    && chown -R pixishelfworker:nodejs /app

COPY --from=builder --chown=pixishelfworker:nodejs /worker-runtime/package.json ./package.json
COPY --from=builder --chown=pixishelfworker:nodejs /worker-runtime/node_modules ./node_modules
COPY --from=builder --chown=pixishelfworker:nodejs /worker-runtime/dist ./dist

USER pixishelfworker

EXPOSE 3011

HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=4 \
    CMD ["node", "dist/healthcheck.cjs", "--mode=live"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.cjs"]
