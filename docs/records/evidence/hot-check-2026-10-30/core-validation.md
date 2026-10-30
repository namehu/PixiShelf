# Hot batch core validation, 2026-10-30

Workspace: `/Users/namehu/.codex/worktrees/dedup-visual-search-v2/PixiShelf`.
Database tests used only the dedicated database configured by `/private/tmp/pixishelf-dedup-hot-20261030/core.env.sh` (created and migrated by the measurement agent). No default `.env` database was used.

## Passed PostgreSQL coverage

Command (shell sources the dedicated environment first):

```sh
source /private/tmp/pixishelf-dedup-hot-20261030/core.env.sh
pnpm --filter @pixishelf/job-executors exec vitest run src/artwork-dedup/__tests__/executor.postgres.test.ts -t 'v8 hot|v8 rejects a hot|v8 new executor'
```

Result: 13 passed, 69 skipped; tests 20.640 seconds. Includes bounded 100-media hot commit, immediate retry, paused cursor/new executor resume, modified/new/missing-cache/FULL fallbacks, cancellation, lost queue lease, transaction rollback, member insertion/deletion, source writer, directory writer, and existing v8 file-checkpoint restart.

Second command:

```sh
source /private/tmp/pixishelf-dedup-hot-20261030/core.env.sh
pnpm --filter @pixishelf/job-executors exec vitest run src/artwork-dedup/__tests__/executor-lifecycle-telemetry.test.ts src/artwork-dedup/__tests__/executor.postgres.test.ts -t 'committed artwork|v1 rejects a hot|persists file cursors at the byte budget'
```

PostgreSQL file result: 5 passed, 77 skipped; tests 7.368 seconds. Covers four legacy v1 mutation guards and the legacy 3-second byte-budget yield.

That combined invocation initially failed two telemetry assertions because its fixtures had no preceding scheduler evidence but expected zero cooldown. The fixtures/expectations were corrected to distinguish unknown from measured zero; the final standalone telemetry rerun is recorded in `core-telemetry.txt`. The three new telemetry cases passed in the initial invocation.

These PostgreSQL command results are retained in the chat tool execution records; no standalone raw log was captured for those two invocations. This file is a summary, not raw output.

## Types and static checks

`pnpm --filter @pixishelf/db typecheck`: passed.

`pnpm --filter @pixishelf/job-executors typecheck`: passed after fixing the test transaction wrapper's generic signature.

`git diff --check`: passed.

`rg --files packages/pixishelf | rg '[A-Z]'`: no matches (expected exit 1).

No full lint/test/build, migration, production/development database writes, content-cache clearing, or visual algorithm changes were performed by the core implementation agent. No files were committed.
