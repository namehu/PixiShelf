---
status: accepted
---

# Use a durable worker and atomic archive publication

URL archives will run in a dedicated worker backed by PostgreSQL job state and page-level checkpoints. The worker downloads into staging, validates every required item and a self-contained manifest, then acquires a short media-root write lock to atomically publish files and catalog state; the Web process remains read-only. This costs an additional process and durable task models, but long gallery downloads can resume after restarts and incomplete archives never appear as normal Artworks.

## Considered options

- Running downloads inside a Next.js request or fire-and-forget promise was rejected because process restarts strand long-running work.
- Holding the media-root lock for the entire network download was rejected because it would block unrelated scans for hours.
- Introducing Redis and a separate queue product was rejected because PostgreSQL already provides the durability needed for the current self-hosted deployment.

## Consequences

Paused staging is retained until resumed or deleted; failed and cancelled staging is retained for seven days. Network download and validation may overlap existing scans, while final publication remains serialized. Media deletion uses a seven-day trash window rather than immediate permanent removal.
