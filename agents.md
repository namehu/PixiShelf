# Agents Guide

This file gives coding agents the minimum project context needed to work safely in this repository.

## Project Overview

PixiShelf is a pnpm workspace for a personal web gallery that manages local image collections.

- `packages/pixishelf`: main Next.js app, API routes, Prisma schema, admin UI, gallery UI.
- `packages/pixishelf-extension`: WXT browser extension for PixiShelf download workflows.
- `packages/pixiv-standalone-scanner`: small Express service for Pixiv metadata paths.
- `packages/zip-convert`: Express/Node utilities for converting Pixiv zip/APNG assets.
- `build`: Docker Compose and deployment assets.
- `docs`, `scripts`, `data`, `todos`: supporting documentation and project utilities.

## Tooling

- Use `pnpm`; this is a pnpm workspace.
- Node.js should be at least 18 according to `package.json`; README recommends Node.js 20 LTS.
- Prefer `rg` for searching files and text.
- Keep changes scoped to the package or feature being touched.
- Do not rewrite generated output, lockfiles, or deployment files unless the task requires it.

## Common Commands

Run from the repository root unless noted otherwise.

```bash
pnpm install
pnpm dev
pnpm build
pnpm format
```

Main app commands:

```bash
cd packages/pixishelf
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm db:generate
pnpm db:push
pnpm db:migrate
pnpm db:studio
```

Browser extension commands:

```bash
cd packages/pixishelf-extension
pnpm dev
pnpm build
pnpm compile
pnpm zip
```

Utility services:

```bash
cd packages/pixiv-standalone-scanner
pnpm start

cd packages/zip-convert
pnpm start
```

## Local Environment

- Docker Compose environment: `build/.env`.
- Local Next.js environment: `packages/pixishelf/.env.local`.
- Do not assume those two files share the same database host. Docker usually uses `postgres:5432`; local development usually uses `127.0.0.1:5432` or `localhost:5432`.
- Main app dev server runs on `http://localhost:5430`.
- Prisma Studio runs on `http://localhost:5555` when started.

Typical local startup for the main app:

```bash
cd build
docker-compose -f docker-compose.dev.yml up -d postgres imgproxy thumbor

cd ../packages/pixishelf
pnpm db:generate
pnpm db:push
pnpm dev
```

## Coding Notes

- The main app uses Next.js App Router, React, TypeScript, Prisma, Tailwind CSS, Radix UI, TanStack Query, Zustand, Zod, and lucide-react.
- Prefer existing components and patterns under `packages/pixishelf/src` before adding new abstractions.
- Use Prisma and typed data access instead of ad hoc SQL/string parsing where possible.
- Use Zod or existing validation helpers for runtime input validation.
- Keep UI consistent with the current app: functional, responsive, and concise.
- Use lucide-react icons for icon buttons when an appropriate icon exists.
- Avoid broad refactors when fixing a local bug.

## Test Organization

- Do not place new test files beside implementation files.
- Put unit and component tests in a dedicated `__tests__` directory near the code under test.
- For package-level or cross-module tests, use the package's existing `tests` directory when that is the established local pattern.
- When moving existing same-level `*.test.ts` or `*.test.tsx` files into `__tests__`, update relative imports and mocks from `./module` to the correct parent path such as `../module`.
- After moving tests, run the narrowest relevant `pnpm test` or `pnpm vitest run ...` command for the moved files.

## Verification

- For main app changes, run the narrowest useful check first:

```bash
cd packages/pixishelf
pnpm lint
pnpm test
pnpm build
```

- For extension changes:

```bash
cd packages/pixishelf-extension
pnpm compile
pnpm build
```

- If a check cannot run because services, environment variables, or network access are missing, report that clearly.

## Git Hygiene

- The worktree may contain user changes. Do not revert files you did not change.
- Before editing a file with existing modifications, inspect it and preserve the user's work.
- Avoid destructive commands such as `git reset --hard` or checkout-based reverts unless explicitly requested.
