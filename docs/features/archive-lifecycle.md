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

[Mermaid 源文件](../diagrams/features/archive-flow.mmd)。依据：archive-intake 服务，以及 Worker 的 resolver、executor、publisher 与 storage。泳道按责任区分，三个执行通道仍处于同一个 Worker。

`ArchiveImport.id` 贯穿整项归档，`systemJobId` 指向当前执行，`phase` 区分 LEGACY、DOWNLOAD、PUBLISH；阶段关联保留每次执行和重试。`ARCHIVE_DOWNLOAD@1` 在下载通道形成逐图检查点、执行全部媒体长度/SHA-256/尺寸校验并生成 manifest。流和 reporter 停止、所有句柄关闭后，同一个 fenced finalizer 复核当前任务、generation、控制和清理意图，保存封存摘要，创建幂等 `ARCHIVE_PUBLISH@1`，CAS 切换当前阶段并完成下载任务。

`ARCHIVE_PUBLISH@1` 在 writer 中只读取封存清单和检查点，核对绑定、来源删除意图与作品 ACTIVE 状态，再 rename 到正式 revision。它不发网络请求或再次全量读取/hash 媒体。发布短事务沿用创作者/归档发布锁，更新 Artwork、来源、标签、阅读版本、Image 和当前 revision，最后完成整项归档。rename 成功而事务失败时保留目录，重试同发布阶段；身份未知目录不得覆盖。正常读取只采用已提交的发布指针。

### Generation 与清理

每次未封存执行接管都登记 `.archive-staging/<importId>--<executionToken>`，媒体最终文件也携带 token，且不覆盖已有文件。文件关闭/fsync 后才提交 fenced checkpoint。恢复将各 checkpoint 指向的已完成文件复制到新代，核验长度与 SHA-256；有效文件不走网络，缺失或损坏文件才补下载。全部完成后不再写封存代。

`cleanupRequestedAt` 是领取、控制与交接门禁。清理先 CAS 保存意图，确认没有当前执行，再只删除登记且明确 `drainedAt` 的代。lease 过期不代表旧 I/O 停止；没有 drain 证据的旧代保留为隔离 orphan，不能在线按超时盲删。旧版本已 rename 未发布的目录必须核对 manifest 来源/导入身份和持久检查点后才能复用或清理；未知身份保留原样并报冲突。普通扫描无论环境排除列表如何配置，均硬排除 `sources`、`.archive-staging`、`.trash`。

这不是跨数据库和文件系统的分布式事务。文件准备后事务失败可能留下未发布目录；重试复用已验证文件并重新完成发布，取消或清理由持久维护任务收口，不把孤立文件直接暴露。更新同一来源身份仍保留人工标题／描述覆盖、受保护标签和创作者关系；重建媒体使旧阅读状态失效。不同 E-Hentai 版本身份保留独立作品，见[版本关系](./archive-intake.md#e-hentai-版本关系与归档身份)。

## 执行责任

URL 解析、来源扫描、发现批次及标题预览使用 `ARCHIVE_RESOLVE`；归档下载、恢复复制与完整性校验使用 `ARCHIVE_DOWNLOAD`；发布、原媒体／派生媒体处理和维护使用 `BACKGROUND_WRITER`。每个通道最多一个有效执行，三者可同时推进。下载 A 进入等待入库后即释放下载通道供 B 使用。三通道共享进程、网络、数据库和挂载，不是操作系统资源隔离。

单件归档内部可配置 1–8 条媒体流，每次启动、恢复或重试时冻结，运行中不能调整；这不改变每条通道的任务并发。任务、版本与通道的完整清单由共享契约和 Executor Registry 决定，Worker READY 与 capability audit 都必须通过。领取围栏、租约和计划物化机制见[后台任务业务链路](../architecture/background-job-business-flows.md)。

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

## 下载通道升级与恢复

升级前停止调度、App、旧 Worker 及外部文件写入者，确认旧 Worker 进程已经退出，按[备份基线](../operations/backup-and-recovery.md)保存数据库、原媒体（含隐藏 staging）、派生媒体、配置及配套镜像的同点恢复集合。先部署 `20261023000000_archive_download_lane_enum` 和 `20261023001000_archive_download_lane`，再运行配套 App/Worker；SQL 仅改变结构和阶段关联，不搬动文件。旧代码仍可能覆盖共享文件，禁止混跑或直接降级镜像。

旧 `ARCHIVE_IMPORT@1/@2` 保留原 type/lane，兼容执行器仅在 fenced 事务中创建下载后继并写 HANDOFF 结果。v1 默认标签为空，v2 沿用冻结值；不可可靠辨认的旧来源保持未知。原可执行时间、退避和重试预算保留；暂停需用户恢复，PAUSING/CANCELLING 优先服从控制，耗尽预算的失败任务不自动复活。显式重试创建新阶段任务。旧部分完成 staging 在下载阶段核验复用，已 rename 的完整版本只读核验后封存原目录，不搬回、不重复下载。

正常重启不需要人工解除目录锁。失联旧代不妨碍新代下载；离线清理 orphan 前必须确认所有写入者退出，对照 generation、manifest、当前指针和发布 revision 保存恢复依据。任何已发布目录不能作为 staging 清理目标。

## 自动入队升级与恢复

`20260909100000_archive_intake_download_mode` 新增下载模式和 `SKIPPED` 终态，历史模式默认 MANUAL，画质仍默认 ORIGINAL。正式升级按[备份与恢复](../operations/backup-and-recovery.md)建立一致性检查点，以 generate/deploy 流程部署迁移并同步升级 App/Worker。开发验证使用隔离库，不迁移现有收藏库。

回滚前停止新提交并等待或取消活动任务；保留新增字段与已创建任务，不通过降级 SQL 删除记录或媒体。旧 Worker 不执行自动衔接，旧 App 不理解 SKIPPED，不能混合版本继续处理自动模式记录；可恢复同一版本，或在停写后成组恢复数据库与媒体检查点。

## 运维不变量

1. lane migration 是旧 Worker 的回滚边界；迁移后不得启动不理解 lane 的消费者。
2. 切换前必须停止调度和写入者、通过专用只读 audit，并建立数据库、原媒体、派生媒体、配置和镜像 digest 的一致性检查点。
3. 旧中央切换开关已退役，设置为 false 不能禁止消费；维护必须停止 App、scheduler、Worker 和外部写入者。只允许启动兼容当前 schema 的版本；退回旧消费者须整体恢复切换前检查点。
4. 归档清理和永久删除只能由 writer lane 中的持久维护任务执行，不能用页面循环或手工删目录代替。

通用操作顺序见[部署基线](../operations/deployment.md)和[备份与恢复](../operations/backup-and-recovery.md)。任务控制、传输状态与失败重试见[收件箱](./archive-intake.md)，租约与能力校验见[后台任务架构](../architecture/background-job-business-flows.md)。
