---
status: accepted
date: 2026-10-23
scope: 同一 Worker 内独立归档下载、封存交接和串行发布
supersedes-in-part: ./0004-run-archive-resolution-in-a-separate-worker-lane.md
implementation: ../features/archive-lifecycle.md
---

# Separate archive downloads from publication

## Context

整件作品的网络下载可能持续数小时。旧 `ARCHIVE_IMPORT` 在此期间占用 writer 的唯一执行槽，使扫描、派生媒体和其他维护任务等待。自动归档被标记为手动优先级也使系统任务难以竞争。用户需要下载与其他工作真正同时推进；把下载分片后轮流执行不能满足这一目标。

## Decision

仍使用一个 Worker 进程，运行 `ARCHIVE_RESOLVE`、`ARCHIVE_DOWNLOAD`、`BACKGROUND_WRITER` 三个 Dispatcher，各 lane 在数据库中最多有一个有效执行。新增 `ARCHIVE_DOWNLOAD@1` 与 `ARCHIVE_PUBLISH@1`，类型和 lane 不可变。前者下载、恢复校验和封存，后者只核对清单身份、rename 并执行短发布事务。下载 A 封存后可以立即下载 B，不等待 A 发布。

`ArchiveImport.id` 是稳定业务身份，当前 `systemJobId`、持久 phase、执行关联与 staging generation 保存所有阶段及重试。每次未封存接管使用新 executionToken 目录，完整文件关闭并 fsync 后才写 fenced checkpoint。恢复复制已提交文件并核验 SHA-256，不使用跨代硬链接。旧执行迟到写入只能落在旧代；过期租约不等于文件 I/O 已停止。

下载流和 reporter 全部停止、全量完整性校验及清单完成后，在同一个 fenced finalizer 中封存、创建唯一后继、切换当前阶段并完成前驱。不存在等待子任务而占槽的运行中父任务。默认标签、画质和真实 MANUAL/AUTO 来源沿用冻结值；AUTO 阶段使用 SYSTEM / 900，手动阶段使用 MANUAL / 10。交接不会发整项成功通知，整体完成以发布事务为准。

清理先持久化意图，阻断同导入的领取和交接，再按已登记且确认 drain 的 generation 精确删除。未确认 drain 的旧代保留为隔离 orphan，离线停写后处理。普通扫描硬排除 `sources`、`.archive-staging`、`.trash`。旧 v1/v2 仅转交，已 rename 的旧目录在下载通道只读核验后复用。上线必须确认旧 Worker 已退出，不能混跑。

## Consequences

下载与 writer 可以重叠，但共享 CPU、网络、磁盘、数据库连接和权限；不构成操作系统资源隔离。writer 内的正式媒体发布和维护仍串行，图片内部并发仍遵循数据库设置默认 2、上限 8。每次接管复制完整检查点增加磁盘占用；失联代可能需要离线清理。这些成本用于保证迟到写入不能覆盖当前或已封存文件。

本 ADR 局部替代 ADR-0004 的所有媒体写任务均在 writer 串行条款，保留单进程、持久队列、固定类型/lane 映射和租约围栏。操作与恢复的唯一详细规则见[归档生命周期](../features/archive-lifecycle.md)，验证证据见[实施记录](../records/archive-download-lane-2026-10-23.md)。
