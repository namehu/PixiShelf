# Agents Guide

This file gives coding agents the minimum project context needed to work safely in this repository.

## Project Overview

PixiShelf is a pnpm workspace for a personal web gallery that manages local image collections.

- `packages/pixishelf`: main Next.js app, API routes, admin UI, gallery UI, and job control plane.
- `packages/pixishelf-db`: Prisma schema, migrations, generated database client, and schema guards.
- `packages/pixishelf-job-contracts`, `packages/pixishelf-job-runtime`, `packages/pixishelf-job-executors`: shared background-job contracts, runtime, and executor implementations.
- `packages/pixishelf-worker`: standalone Central Dispatcher Worker with separate archive-resolve and background-writer lanes.
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
pnpm check:quick
pnpm check:full
pnpm format
```

Do not use the root `pnpm dev` as the standard startup command: it recursively starts every workspace package that
defines `dev`, including processes that are not part of the normal local topology. Follow the root `README.md` and
start the main app from `packages/pixishelf` after PostgreSQL, ImgProxy, migrations, and the general Worker are ready.

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

Utility services:

```bash
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
docker compose --env-file build/.env -f build/docker-compose.dev.yml up -d postgres imgproxy

# Export DATABASE_URL from packages/pixishelf/.env.local in the current shell first.
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/db db:deploy

docker compose --env-file build/.env -f build/docker-compose.dev.yml up -d --build worker

cd packages/pixishelf
pnpm dev
```

Follow the root `README.md` for the complete cross-platform sequence, required paired environment variables, Worker
readiness checks, and shutdown commands. Never use `db:push` for ordinary startup or upgrades; it does not update
`_prisma_migrations`.

## Coding Notes

- The main app uses Next.js App Router, React, TypeScript, Prisma, Tailwind CSS, Radix UI, TanStack Query, Zustand, Zod, and lucide-react.
- Every ordinary file and directory name under `packages/pixishelf` must use lowercase kebab-case. Do not introduce uppercase letters, PascalCase, camelCase, or snake_case in paths; this also applies to component files, hooks, stores, tests, documentation, and Next.js dynamic route segment names. Framework or tooling syntax such as `_components`, `__tests__`, `[id]`, and filename suffixes like `.test.ts` remains allowed, but its words must stay lowercase.
- Keep in-code identifiers in their normal TypeScript conventions (for example, PascalCase React components and camelCase hooks); the kebab-case rule applies to filesystem paths. Before finishing a change, run `rg --files packages/pixishelf | rg '[A-Z]'` and resolve every result.
- Prefer existing components and patterns under `packages/pixishelf` before adding new abstractions. The main app has
  no `src/` directory; `app/`, `components/`, `server/`, `services/`, and `lib/` are package-root directories.
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

## Documentation

- Start from `docs/README.md`. It records each document's status, authority, and replacement path.
- Read `docs/product/product-baseline.md` before changing target users, core workflows, product invariants, or
  supported/non-goal boundaries; use `CONTEXT.md` for the shared domain language.
- Read `docs/security/access-control.md` before changing authentication, public paths, HTTP routes, tRPC procedures,
  Server Actions, trusted headers, tokens, ports, networks, or media mount permissions.
- A `current` document must describe deployed behavior. Future work belongs in a `draft`; one-time cutovers and retired
  designs belong in `historical` documents.
- Exact fields and configuration remain authoritative in Prisma, Zod, TypeScript, Compose, and `.env.example` files.
  Documentation should explain intent, boundaries, invariants, risks, and operating procedures instead of duplicating
  every field.
- Update affected documentation in the same change when modifying product boundaries, cross-package dependencies,
  database meaning or migrations, auth/API contracts, deployment topology, environment variables, backup/recovery,
  or a hard-to-reverse technical decision.
- Do not turn a proposal into current documentation until its implementation and verification are complete.
- When documentation conflicts with code or runtime configuration, report the conflict, establish the current fact,
  and fix or downgrade the document before relying on it.

## Verification

- Use `docs/development/testing-strategy.md` to combine the required checks for every affected change type. Its CI
  section describes actual coverage and must not be treated as proof for checks that CI does not run.
- For main app changes, run the narrowest useful check first:

```bash
cd packages/pixishelf
pnpm lint
pnpm test
pnpm build
```

- `pnpm build` for `packages/pixishelf` runs Next.js/Turbopack and may hang indefinitely under the filesystem/process sandbox. When verifying the main app build, run it with escalated permissions up front instead of waiting on a sandboxed build.
- If a check cannot run because services, environment variables, or network access are missing, report that clearly.
- For migration, storage, deployment, bulk replacement, or destructive workflow changes, follow
  `docs/operations/backup-and-recovery.md` and record the required consistent checkpoint or recovery evidence.

## Git Hygiene

- The worktree may contain user changes. Do not revert files you did not change.
- Before editing a file with existing modifications, inspect it and preserve the user's work.
- Avoid destructive commands such as `git reset --hard` or checkout-based reverts unless explicitly requested.
