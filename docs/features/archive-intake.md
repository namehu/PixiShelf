---
status: current
scope: URL 归档收件箱、持久解析、批量入队、任务控制、维护与保留策略
last-verified: 2026-08-28
sources:
  - packages/pixishelf/app/admin/archive/
  - packages/pixishelf/server/routers/archive-inbox.ts
  - packages/pixishelf/server/routers/archive.ts
  - packages/pixishelf/services/archive-intake/
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-job-contracts/src/job-types.ts
  - packages/pixishelf-job-executors/src/archive/
  - packages/pixishelf-job-executors/src/maintenance/
---

# 归档收件箱

归档收件箱把 URL 采集、远端解析和媒体写入拆成可恢复的持久流程。管理员可以持续追加链接，无需等待上一条解析完成；已经就绪的项目可以随时多选并入队，每个作品仍对应一个独立归档任务并在媒体写通道中串行执行。

精确字段、状态和 payload 以 Prisma、Zod 与任务契约为准。本文说明用户流程、资源边界、生命周期和运维不变量。

## 页面与用户流程

| 页面                   | 职责                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `/admin/archive/inbox` | 批量追加 URL、查看 FIFO 解析状态、修正、重试、取消与批量入队 |
| `/admin/archive`       | 服务端分页和筛选归档任务、查看明细、单项及当前页批量控制     |

“添加链接”弹窗每次接受最多 100 行；服务端重新校验 URL、幂等键和活动收件容量。活动收件项目最多 1000 个。创建 submission 后请求立即返回，远端解析不占用浏览器或 Next.js 长连接。

收件项目平铺在全局 FIFO 中，submission 只标记一次提交和提供审计/筛选上下文，不形成必须等待全部完成的封闭批次。管理员可以在解析继续进行时选择 `READY` 项，按项目选择 `ORIGINAL` 或 `DISPLAY` 质量并批量入队。每项独立返回创建、复用、跳过、冲突或失败结果；重复命令通过持久幂等记录复用原结果。

解析结果区分新归档、更新、无变化、已有活动任务和重复来源身份。解析快照到期后不能直接入队，必须重新排队解析；修正失败 URL 会创建关联的新项目，不改写原审计历史。

任务页支持服务端 cursor 分页、状态/Provider/新建或更新/submission/文本筛选，以及 `PAUSE`、`RESUME`、`CANCEL`、`RETRY` 的当前页批量控制。批量命令逐项重新检查最新状态，不把部分冲突扩大成整批失败。回收、恢复、永久清理和 staging 清理仍走专用归档维护命令，不属于任务批量控制。

## 持久状态与恢复

核心持久结构包括：

- `ArchiveIntakeSubmission` 与 `ArchiveIntakeItem`：保存输入、FIFO 顺序、解析状态、冻结结果、重试/取消 intent 和归档关联；
- `ArchiveBulkOperation` 与逐项结果：保存批量入队和任务控制的请求者、幂等键、目标与结果；
- `SystemJob.executionLane`：把解析工作和所有媒体写工作映射到固定资源通道；
- Worker lease、heartbeat、attempt 与 `leaseToken`：为领取、进度和终态提供数据库执行围栏。

收件队列暂停只阻止领取下一项，不中断当前解析。取消当前解析使用持久 intent 和 cooperative abort；瞬时错误按退避策略重试并重新进入队尾。浏览器刷新、App 部署或 Worker 重启不会丢失 FIFO、attempt、暂停状态或已完成的批量结果。

## Worker 双通道

生产只有一个 `pixishelf-worker` 容器和进程，但它运行两个异步 Dispatcher loop：

| Lane                | 允许任务                     | 固定并发 |
| ------------------- | ---------------------------- | -------- |
| `ARCHIVE_RESOLVE`   | `ARCHIVE_RESOLVE_ITEM`       | 1        |
| `BACKGROUND_WRITER` | 其余 24 类任务，包括归档下载 | 1        |

两个 lane 可以各推进一个任务；同一 lane 内不能并行。网络、数据库、文件流、Sharp/libvips 与 FFmpeg 子进程在等待时让出 Node.js 事件循环，因此链接解析可以在一个 writer 工作期间继续。该模型不承诺纯 JavaScript CPU 并行，也不开放可配置并发。

所有原媒体、派生媒体、staging、发布、扫描、迁移、替换和维护写操作都在 `BACKGROUND_WRITER` 全局串行。`ARCHIVE_RESOLVE` 的 Executor 契约只访问解析所需的远端数据和数据库，不执行媒体目录写入；两个 lane 仍共用同一 Worker 进程和 `rw` 挂载，因此这是队列/capability 边界，不是操作系统权限隔离。数据库按 lane 的执行态唯一索引与 `lane/archive-resolve`、`lane/background-writer` 资源租约共同防止滚动部署或误启动第二个 Worker 时出现同 lane 双执行。

生产 capability inventory 固定为 25 个 job type；`SCAN` 支持 v1/v2/v3，`ARCHIVE_IMPORT` 支持 v1/v2，其余 23 类只支持 v1，共 28 个
type/version 组合，并同时校验 job type、definition version 和 lane。READY 证明预检通过，capability audit
证明 Registry 精确匹配；两者都通过后才可开放 claim。`SCAN@v2/v3` 不改变归档收件任务及其 lane。

## 归档维护与保留

归档文件生命周期统一由 `ARCHIVE_MAINTENANCE` 在 writer lane 执行：

| Action            | 责任                                             |
| ----------------- | ------------------------------------------------ |
| `CLEAN_STAGING`   | 清理已持久化的归档 staging intent                |
| `TRASH_ARCHIVE`   | 将已发布归档移入回收区并推进领域状态             |
| `RESTORE_ARCHIVE` | 在保留期限内恢复回收区归档                       |
| `RECONCILE`       | 发现孤立/到期 intent，并为每个目标幂等创建子任务 |
| `PURGE_ARCHIVE`   | 到期后受根目录约束地删除归档文件和对应领域记录   |

默认启用的 `archive_maintenance_reconcile` 在页面中的默认显示时间是 `02:05`。中央模式实际在上海时间 `00:00-08:00` 统一窗口内物化当天任务，并按优先级执行；当前 `HH:mm` 不参与 materializer 计算。`RECONCILE` 父任务只发现和创建按目标隔离的维护子任务，不在发现事务中做文件 I/O；子任务继续经过 writer lane、路径边界、发布互斥和 fenced 终态检查。正常作品删除与归档任务操作也写入同一中央维护流程，不依赖 Next.js 进程内队列。

默认启用的 `archive_intake_retention_cleanup` 页面默认显示时间是 `02:15`，同样按中央统一窗口和优先级执行。终态收件项目、已完成批量操作、无项目的旧 submission 和过期 `ArchivePreviewSession` 保留 30 天后分批清理。它只删除操作历史和冻结预览，不删除 `ArchiveImport`、`SystemJob`、`Artwork`、`ArchiveRevision`、`Image` 或任何媒体文件。

## 权限与敏感数据

两个页面都需要 Better Auth Session。`archiveInbox` 和 `archive` 的读取使用 `authProcedure`，创建、暂停/恢复、取消、重试、批量入队和任务控制使用 `adminProcedure`；当前单一信任域中二者运行能力相同，但敏感写操作保留显式管理员语义。

服务端负责 URL/行数/容量上限、Provider HTTPS allowlist、DNS/redirect/SSRF 防护、响应体限制、状态 CAS 和幂等约束。普通列表、事件、日志和错误不得泄露 Cookie、Authorization、完整 locator、token 或 URL 路径中的敏感段；归档任务序列化统一执行脱敏。

## 运维不变量

1. 生产只有一个通用 Worker 服务，但允许一项解析与一项 writer 工作同时推进。
2. 任意时刻最多一个 resolver、最多一个 writer；不得增加第二个 writer 或通过配置提高并发。
3. lane migration 是旧 Worker 的回滚边界；迁移后不得启动不理解 lane 的消费者。
4. 切换前必须停止调度和写入者、通过专用只读 audit，并建立数据库、原媒体、派生媒体、配置和镜像 digest 的一致性检查点。
5. 迁移后的应用级隔离使用兼容双 lane schema 的 App/Worker 与 `false/false`；启动旧消费者只能通过恢复完整的切换前检查点。
6. 归档清理和永久删除只能由 writer lane 中的持久维护任务执行，不能用页面循环或手工删目录代替。

相关文档：

- [当前架构](../architecture/current-architecture.md)
- [后台任务业务链路](../architecture/background-job-business-flows.md)
- [权限与接口边界](../security/access-control.md)
- [部署基线](../operations/deployment.md)
- [备份与恢复](../operations/backup-and-recovery.md)
- [ADR-0002](../adr/0002-use-a-durable-worker-and-atomic-archive-publication.md)
- [ADR-0004](../adr/0004-run-archive-resolution-in-a-separate-worker-lane.md)
- [实现设计归档](../design/archive-intake-queue.md)
