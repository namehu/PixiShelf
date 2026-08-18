---
status: accepted
scope: 持久 Worker、staging 验证和原子归档发布
last-verified: 2026-08-18
---

# Use a durable worker and atomic archive publication

URL archives will run in a dedicated worker backed by PostgreSQL job state and page-level checkpoints. The worker downloads into staging, validates every required item and a self-contained manifest, then moves staging to a deterministic immutable revision directory and uses a fenced database transaction to switch catalog state. A crash before the catalog switch leaves a resumable prepared revision rather than replacing current media; the Web process remains read-only. This costs an additional process and durable task models, but long gallery downloads can resume after restarts and incomplete archives never appear as normal Artworks.

## Considered options

- Running downloads inside a Next.js request or fire-and-forget promise was rejected because process restarts strand long-running work.
- Holding the media-root lock for the entire network download was rejected because it would block unrelated scans for hours.
- Introducing Redis and a separate queue product was rejected because PostgreSQL already provides the durability needed for the current self-hosted deployment.

## Consequences

Paused staging is retained until resumed or deleted; failed and cancelled staging is retained for seven days. Explicit cleanup is a durable database intent fulfilled by the read-write worker, never a file operation in the read-only Web process. Network download and validation may overlap existing scans, while final publication remains serialized. Media deletion uses a durable, worker-reconciled lifecycle (`TRASHING`, `TRASHED`, and `RESTORING`) across every immutable revision, with a seven-day trash window rather than immediate permanent removal.
