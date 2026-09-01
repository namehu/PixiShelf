---
status: accepted
date: 2026-08-18
scope: 单通用 Worker 内的归档解析与媒体写入资源通道
last-verified: 2026-08-19
supersedes-in-part: ./0003-unify-background-jobs-under-a-durable-single-worker.md
implementation: ../features/archive-intake.md
superseded-in-part-by: ./0006-freeze-database-configured-archive-media-concurrency.md
---

# Run archive resolution in a separate worker lane

## Context

[ADR-0003](./0003-unify-background-jobs-under-a-durable-single-worker.md)选择 PostgreSQL 持久队列、一个通用
`pixishelf-worker` 和全局并发 1。该约束解决了任务资源范围不清晰、多个旧消费者重叠、媒体根目录写入
互斥和部署可预测性问题；本 ADR 已实施并只修订其执行槽范围。

归档收件队列引入一种边界更窄的工作：`ARCHIVE_RESOLVE_ITEM` 只校验 Provider URL、读取远端元数据并冻结
媒体计划，不写原媒体、派生媒体、staging 或发布目录。若它继续与 `ARCHIVE_IMPORT`、扫描、迁移、FFmpeg
和维护任务共用一个执行槽，会出现两个问题：

- 一个长归档下载期间不能解析后续输入，收件队列看似可追加，实际上停止前进；
- 大量待解析 URL 先进入同一 FIFO 时，又可能让已经确认的归档下载长期等待。

把解析放回 Next.js 或浏览器并发不能满足持久恢复、取消、审计和远端限流要求。增加第二个专用容器则会扩大
部署、健康检查、数据库连接、限流协调和滚动发布表面。

## Decision

保留一个可独立部署的 `pixishelf-worker` 容器，在同一个 Node.js 进程中运行两个固定的逻辑执行通道：

| Lane                | 允许工作                            | 固定并发 |
| ------------------- | ----------------------------------- | -------- |
| `ARCHIVE_RESOLVE`   | `ARCHIVE_RESOLVE_ITEM`              | 1        |
| `BACKGROUND_WRITER` | 所有现有任务，包括 `ARCHIVE_IMPORT` | 1        |

两个 lane 可以各运行一个 SystemJob。同一 lane 内仍然只运行一个任务。这个决策只修订 ADR-0003 的“整个 Worker
最多一个 RUNNING job”条款；以下决定保持不变：

- 只有一个通用 Worker workspace、镜像和生产服务；
- Next.js 只负责管理员控制面，不执行长任务；
- PostgreSQL 是任务、租约、heartbeat、事件和恢复的权威来源；
- workerId、attempt、leaseToken 和 CAS 终态继续形成执行围栏；
- scheduler 只物化任务；
- 所有可能修改原媒体或派生媒体的任务仍在 writer lane 全局串行；
- 不引入 Redis、外部队列或可配置通用并行度。

`SystemJob` 持久保存 `executionLane`。现有任务和现有行迁移为 `BACKGROUND_WRITER`。Executor capability 注册必须
声明 job type、definition version 和 lane，Worker capability audit 验证三者没有漂移。

数据库资源租约从一个 `global/background-worker` 拆为：

- `lane/archive-resolve`
- `lane/background-writer`

每个 lane 独立 claim、heartbeat 和 drain。即使滚动部署期间出现两个 Worker 进程，每个 lane 也最多只有一个
有效执行者。不能只依赖“Compose 配置了一个副本”保证正确性。

## Why Node.js can host both lanes

归档解析和媒体写入的主要等待来自 HTTP、PostgreSQL、文件流、Sharp/libvips 和 FFmpeg 子进程。一个异步
Dispatcher 在 `await` 时会把事件循环交给另一个 lane，因此同一 Node.js 进程可以并发推进一个解析任务和
一个 writer 任务。

这不是对纯 JavaScript CPU 并行的承诺。同步 CPU 热点仍会阻塞两个 lane；只有在采样证明它成为瓶颈后，才
考虑 `worker_threads` 或独立进程。不能因为本 ADR 存在就继续增加任意 lane 或提高并发。

## Resource and rate invariants

1. `ARCHIVE_RESOLVE` 不获得原媒体或派生媒体写能力。
2. 任意时刻最多一个 writer job 处于有效执行状态。
3. 任意时刻最多一个 archive resolve job 处于有效执行状态。
4. 单个 `ARCHIVE_IMPORT` 的媒体请求并发由数据库后台设置决定，并在每次执行启动时冻结；见 ADR-0006。
5. 解析和下载共享 Provider 级请求预算；下载优先，解析在限流时退避。
6. 网络、FFmpeg 和文件复制不得放入长数据库事务。
7. 一个 lane 的不可恢复基础设施错误终止整个 Worker，避免半存活 READY 进程。
8. Worker 优雅停机先停止两个 lane 的 claim，再分别 drain 当前任务。

## Considered options

### Keep the global single execution slot

Rejected for this feature. 该选项最简单并保留 ADR-0003 原约束，但不能同时满足“持续 FIFO 解析”和
“已确认作品继续下载”。任一队列积压都可能阻塞另一类工作。

### Resolve in Next.js

Rejected. Provider 解析可能包含多次远端分页，不能依赖一次 HTTP 请求或 Web 进程生命周期完成。刷新、部署或
请求超时会丢失执行所有权，且 Web 进程不应成为后台消费者。

### Resolve concurrently in the browser

Rejected. 浏览器关闭即停止，无法形成共享 FIFO、持久重试、全局 Provider 限流或管理员审计，也会放大并发
请求压力。

### Add a dedicated archive-resolver container

Rejected for now. 该选项提供更强故障隔离，但需要第二个部署单元、独立健康和 heartbeat、更多数据库连接，
以及跨进程 Provider 限流。当前工作以异步 I/O 为主，同进程 lane 已满足目标。

### Allow configurable lane concurrency

Rejected. 当前只证明了解析与 writer 资源可分离，没有证明两个解析或两个 writer 可以安全运行。并发固定为
1 是正确性约束，不是默认配置。

### Split every background task into resource lanes

Rejected for this change. 其他任务的目录、数据库和 CPU 资源关系没有完成同等级审计。除
`ARCHIVE_RESOLVE_ITEM` 外，所有现有任务继续进入 writer lane。

## Consequences

### Positive

- 链接可以在作品下载期间继续按 FIFO 解析；
- 仍只有一个 Worker 镜像、容器、配置入口和健康端口；
- 现有媒体写入全局串行不变量保持；
- 两个 lane 都使用相同的持久任务生命周期、事件和恢复协议；
- 解析不再依赖浏览器或 Next.js 长请求；
- 未来可以通过明确资源审计增加 lane，而不是开放无边界并行。

### Negative

- 队列 repository、Dispatcher、健康状态、graceful shutdown 和 capability audit 都要从单执行状态改为 lane-aware；
- PostgreSQL 并发测试矩阵显著扩大；
- 同进程故障会同时停止两个 lane；
- 同步 CPU 阻塞仍会影响两个 lane；
- Provider 请求治理必须在两个 lane 和滚动部署重叠时保持一致；
- 该架构不再满足 ADR-0003 字面上的“全局最多一个 RUNNING job”，文档和运行审计必须区分 lane。

### Accepted trade-off

PixiShelf 接受最多两个不同资源类别的后台任务同时推进，以换取收件解析与媒体写入互不饥饿。产品不接受
第二个 writer、多个解析消费者或任意任务并行。简单运维仍优先于吞吐量，因此 lane 并发不开放配置，媒体内部并发也不暴露为环境变量；后者按 ADR-0006 作为数据库后台设置管理。

## Rollout

本 ADR 已随[归档收件箱](../features/archive-intake.md)完成实现。原发布步骤保留如下，作为理解 lane migration
为何构成旧 Worker 回滚边界的历史依据。

实现必须：

1. 使用 cutover migration 增加 lane、回填旧 SystemJob，并把全局执行唯一索引替换为按 lane 唯一索引；
2. 在 migration 前停止旧 Worker，再立即部署同时理解所有旧 job type 和新 resolver job 的新 Worker；
3. 用 PostgreSQL 测试证明“一 resolver + 一 writer”可运行且同 lane 不重叠；
4. 更新 READY、capability audit、事件和停机验证；
5. 在一次协调切换中部署 Worker 与新收件箱；
6. 验证完成后再更新当前架构和产品基线中的全局单槽描述。

直接产品切换不使用长期功能开关。替换全局执行唯一索引的 migration 是旧 Worker 的回滚边界；应用后不能
重启不认识 lane capability 的旧 Worker。必须停止 claim、保留队列数据并前向修复、使用明确兼容的回滚镜像，
或按恢复手册恢复切换前的一致性检查点。
