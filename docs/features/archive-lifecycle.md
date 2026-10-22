---
status: current
scope: URL 归档的文件准备、数据库发布、维护保留及版本恢复边界
last-verified: 2026-10-22
sources:
  - packages/pixishelf-job-executors/src/archive/executor.ts
  - packages/pixishelf-job-executors/src/archive/publisher.ts
  - packages/pixishelf-job-executors/src/archive/storage.ts
  - packages/pixishelf-job-executors/src/archive/maintenance-executor.ts
  - packages/pixishelf-db/prisma/schema.prisma
---

# 归档生命周期与恢复

[来源发现](./archive-discovery.md)负责候选，[收件箱](./archive-intake.md)负责冻结解析与下载意图，本文负责文件何时可以被视为正式作品，以及失败后如何继续。删除后的用户操作和持久防重复下载语义见[归档回收站](./archive-trash.md)。

## 从发现到发布

![归档发现、收件与发布泳道图](../diagrams/features/archive-flow.svg)

[Mermaid 源文件](../diagrams/features/archive-flow.mmd)。依据：archive-intake 服务，以及 Worker 的 resolver、executor、publisher 与 storage。泳道按责任区分，两个执行通道仍处于同一个 Worker。

下载先形成逐媒体持久检查点。全部媒体通过完整性检查后写 manifest，再准备不可变 revision 目录；文件准备成功仍不等于数据库发布成功。最后在有租约围栏的同一事务内复核删除意图、来源身份与控制请求，更新 Artwork、来源快照、Media、当前 revision、创作者与任务终态。正常读取只采用已经发布的指针。

这不是跨数据库和文件系统的分布式事务。文件准备后事务失败可能留下未发布目录；重试复用已验证文件并重新完成发布，取消或清理由持久维护任务收口，不把孤立文件直接暴露。更新同一来源身份仍保留人工标题／描述覆盖、受保护标签和创作者关系；重建媒体使旧阅读状态失效。不同 E-Hentai 版本身份保留独立作品，见[版本关系](./archive-intake.md#e-hentai-版本关系与归档身份)。

## 执行责任

URL 解析、来源扫描、发现批次及标题预览使用解析通道，只访问远端元数据与数据库；归档下载、原媒体／派生媒体处理和维护使用媒体写通道。当前一个通用 Worker 内每个通道最多推进一项任务，所有媒体写任务全局串行。两个通道共享进程与挂载，不是操作系统权限隔离。

单件归档内部可配置 1–8 条媒体流，每次启动、恢复或重试时冻结，运行中不能调整；这不能增加第二个 writer。任务、版本与通道的完整清单由共享契约和 Executor Registry 决定，Worker READY 与 capability audit 都必须通过。领取围栏、租约和计划物化机制见[后台任务业务链路](../architecture/background-job-business-flows.md)。

## 归档维护与保留

归档文件生命周期统一由 `ARCHIVE_MAINTENANCE` 在 writer lane 执行：

| Action            | 责任                                             |
| ----------------- | ------------------------------------------------ |
| `CLEAN_STAGING`   | 清理已持久化的归档 staging intent                |
| `TRASH_ARCHIVE`   | 将已发布归档移入回收区并推进领域状态             |
| `RESTORE_ARCHIVE` | 在保留期限内恢复回收区归档                       |
| `RECONCILE`       | 发现孤立/到期 intent，并为每个目标幂等创建子任务 |
| `PURGE_ARCHIVE`   | 到期后受根目录约束地删除归档文件和对应领域记录   |

默认启用的 `archive_maintenance_reconcile` 由中央计划在上海时间 `00:00-08:00` 窗口内物化当天任务，按优先级执行；当前不提供单项执行时间编辑。`RECONCILE` 父任务只发现和创建按目标隔离的维护子任务，不在发现事务中做文件 I/O；子任务继续经过 writer lane、路径边界、发布互斥和 fenced 终态检查。正常作品删除与归档任务操作也写入同一中央维护流程，不依赖 Next.js 进程内队列。

默认启用的 `archive_intake_retention_cleanup` 同样按中央统一窗口和优先级执行。终态收件项目、已完成批量操作、已完成/失败/取消的上传者扫描记录、无项目的旧 submission 和历史冻结流程中过期的 `ArchivePreviewSession` 保留 30 天后分批清理。该保留任务不会删除来源身份和游标；只有管理员显式删除来源时才移除。该任务只删除操作历史和冻结预览，不删除 `ArchiveImport`、`SystemJob`、`Artwork`、`ArchiveRevision`、`Image` 或任何媒体文件。

## 自动入队升级与恢复

`20260909100000_archive_intake_download_mode` 新增下载模式和 `SKIPPED` 终态，历史模式默认 MANUAL，画质仍默认 ORIGINAL。正式升级按[备份与恢复](../operations/backup-and-recovery.md)建立一致性检查点，以 generate/deploy 流程部署迁移并同步升级 App/Worker。开发验证使用隔离库，不迁移现有收藏库。

回滚前停止新提交并等待或取消活动任务；保留新增字段与已创建任务，不通过降级 SQL 删除记录或媒体。旧 Worker 不执行自动衔接，旧 App 不理解 SKIPPED，不能混合版本继续处理自动模式记录；可恢复同一版本，或在停写后成组恢复数据库与媒体检查点。

## 运维不变量

1. lane migration 是旧 Worker 的回滚边界；迁移后不得启动不理解 lane 的消费者。
2. 切换前必须停止调度和写入者、通过专用只读 audit，并建立数据库、原媒体、派生媒体、配置和镜像 digest 的一致性检查点。
3. 旧中央切换开关已退役，设置为 false 不能禁止消费；维护必须停止 App、scheduler、Worker 和外部写入者。只允许启动兼容当前 schema 的版本；退回旧消费者须整体恢复切换前检查点。
4. 归档清理和永久删除只能由 writer lane 中的持久维护任务执行，不能用页面循环或手工删目录代替。

通用操作顺序见[部署基线](../operations/deployment.md)和[备份与恢复](../operations/backup-and-recovery.md)。任务控制、传输状态与失败重试见[收件箱](./archive-intake.md)，租约与能力校验见[后台任务架构](../architecture/background-job-business-flows.md)。
