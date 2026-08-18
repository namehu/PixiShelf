---
status: accepted
date: 2026-08-14
scope: PostgreSQL 持久队列上的单通用 Worker
last-verified: 2026-08-18
partially-superseded-by: ./0004-run-archive-resolution-in-a-separate-worker-lane.md
---

# Unify background jobs under a durable single worker

> 本 ADR 仍定义当前已上线架构。已接受但尚未实施的
> [ADR-0004](./0004-run-archive-resolution-in-a-separate-worker-lane.md)
> 只修订“整个 Worker 全局最多一个 RUNNING job”为“解析与 writer 各一个固定 lane”；单 Worker、
> PostgreSQL 队列、writer 全局串行和执行围栏决定保持不变。

## Context

PixiShelf currently executes background work through three different mechanisms:

- fire-and-forget promises inside the Next.js process for most scheduled maintenance tasks;
- a database-backed MP4 optimization queue whose consumer still lives in Next.js memory;
- archive and video-keyframe loops hosted by the archive-worker process.

The shared worker process does not provide global serialization: its archive and keyframe loops are started together with Promise.all. Job lifecycle, cancellation, retry, mutex, progress and recovery behavior therefore vary by task type. A Next.js restart can strand maintenance jobs, and deploying a single worker replica alone does not prevent overlapping execution during restarts or accidental scaling.

The administration UI also mirrors these differences. It contains task-specific polling, mutations, status mapping and schedule controls in large components, which makes each new task expensive to add and difficult to reason about.

## Decision

All long-running background work will use PostgreSQL-backed SystemJob instances and a single general-purpose pixishelf-worker.

- The worker remains in the pnpm monorepo but becomes an independently buildable, testable and deployable workspace package and container.
- The worker may depend on extracted @pixishelf/db, @pixishelf/job-contracts and @pixishelf/job-runtime packages, but may not import @pixishelf/next source files or its tsconfig.
- TypeScript/Node remains the worker language. Go or Python will only be considered for a measured bottleneck or a specialized future workload.
- The worker has one Central Dispatcher and executes at most one background job at a time.
- A database JobResourceLease for global/background-worker fences execution even if multiple worker instances are started.
- Every claim creates a workerId, attempt and leaseToken. Heartbeat and terminal transitions use compare-and-set ownership checks.
- Next.js validates administrator commands and enqueues jobs but does not execute long work.
- The scheduler materializes enabled daily tasks into the durable queue.
- Scheduled work competes within a global Asia/Shanghai 00:00–08:00 window. Work not started before the deadline is marked SKIPPED; a running job may finish.
- Manual work may execute outside the window, has a higher priority band, and never preempts a running job.
- Priority aging prevents lower-priority scheduled jobs from being permanently starved inside the window.
- SystemJob stores current state, SystemJobEvent stores a structured history, and JSON stdout logs provide operational detail with bounded rotation.
- Derived-media deletion becomes durable GC intent. Routine video probe/poster runs no longer perform a full orphan-directory scan.
- Existing domain checkpoint models and domain services remain authoritative and are adapted through typed Executors.

## Considered options

### Keep tasks in Next.js

Rejected. Fire-and-forget work is tied to Web process lifetime, deployments can strand jobs, and Next.js scaling can create unplanned concurrency.

### Keep separate archive, media and maintenance workers

Rejected for the current deployment. It would require cross-worker resource locks while providing little throughput benefit because the product explicitly wants one task running at a time.

### Keep a separate container but import the Next.js package source

Rejected. This is the current partial separation: the container is independent, but its build uses the Next.js tsconfig, copies the Next.js package and bundles relative source imports. It prevents independent dependency control and makes unrelated Web changes part of the Worker build surface.

### Move the worker to a separate repository

Rejected. The database contract, task payloads and migration need coordinated changes. A workspace boundary provides independent deployment without losing atomic monorepo changes.

### Rewrite the worker in Go or Python now

Rejected. Current heavy work is performed by FFmpeg/FFprobe, Sharp/libvips, PostgreSQL, network and disk I/O. A language rewrite would duplicate queue, lease, payload and error contracts without evidence that Node orchestration is the bottleneck. Python remains an option for a future AI/CV-specific executor; Go remains an option if profiling identifies a runtime bottleneck.

### Rely only on one deployed worker replica

Rejected as the correctness mechanism. Restarts, rolling deployments and operator error can briefly create multiple processes. The database lease is still required.

### Hold a PostgreSQL lock for the whole task

Rejected. Long-lived transactions or connection-scoped locks consume pool capacity and are fragile when connections are replaced. Short claim transactions plus expiring leases provide recovery without a long-held connection.

### Introduce Redis/BullMQ or another queue product

Rejected for now. PostgreSQL is already required, the desired concurrency is one, and SystemJob already contains much of the durable state. Another service would increase deployment and recovery complexity without solving a current scale constraint.

### Allow configurable parallelism immediately

Rejected. Current task resource relationships are not consistently declared, and several tasks modify the same media or derived-media roots. Concurrency remains fixed at one until resource scopes and idempotency are proven.

### Continue full orphan cleanup inside media generation

Rejected. It makes incremental work proportional to the total derived-media directory size. Durable deletion intent plus periodic dry-run reconciliation is safer and more predictable.

## Consequences

### Positive

- Web deployments no longer terminate background maintenance.
- All task types share one observable and testable lifecycle.
- Accidental second workers do not create a second running task.
- Cancellation, retry and crash recovery have explicit semantics.
- Task dependencies and resource effects are declared centrally.
- The admin UI can use reusable cards, actions, status and event components.
- Video maintenance avoids repeated whole-directory orphan scans.
- Logs and database events have bounded retention.

### Negative

- A long archive or FFmpeg task delays every other background task.
- There is no preemption; urgent manual work waits for the current task.
- Extracting Prisma, task contracts and runtime packages is a material one-time refactor.
- Production cutover requires a planned maintenance window after every old task has reached a terminal state.
- PostgreSQL claim and lease code becomes critical infrastructure and needs race-condition tests.
- Some existing task implementations must become cancellable and idempotent before migration.

### Accepted trade-offs

The product prefers predictable resource use and simple operations over throughput. “轮不到就轮不到” is intentional for scheduled work: jobs that cannot start before 08:00 become explicit SKIPPED history instead of silently accumulating into future days.

The cutover does not require old and new Workers to coexist. The scheduler is disabled, all old work is drained, a read-only audit must report zero active domain states, and then App/Worker are stopped for migration. Old terminal SystemJob rows are retained as LEGACY definition version 0 and are never claimed by the new Worker. Existing published media, archive revisions and derived-media paths are not rewritten or regenerated. Initial GC reconciliation is dry-run only.

## Follow-up

- Implement the additive data model described in background-task-data-model.md.
- Extract @pixishelf/db, @pixishelf/job-contracts and @pixishelf/job-runtime; give @pixishelf/worker its own tsconfig, package boundary and Docker build.
- Migrate the worker host from independent loops to one dispatcher.
- Add a read-only cutover audit that blocks migration on any active SystemJob or incomplete domain publication state.
- Move maintenance handlers out of scheduled-task-registry fire-and-forget promises.
- Add adminProcedure for task management.
- Add structured events and stdout JSON logging with Docker rotation.
- Replace per-run poster orphan cleanup with DerivedMediaGcEntry and weekly dry-run reconciliation.
- Refactor the administration page only after the unified DTO and lifecycle APIs are stable.
