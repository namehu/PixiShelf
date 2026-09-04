---
status: current
scope: URL 归档收件箱、持久解析、批量入队、任务控制、维护与保留策略
last-verified: 2026-09-03
sources:
  - packages/pixishelf/app/admin/archive/
  - packages/pixishelf/server/routers/archive-inbox.ts
  - packages/pixishelf/server/routers/archive-uploader.ts
  - packages/pixishelf/server/routers/archive.ts
  - packages/pixishelf/services/archive-intake/
  - packages/pixishelf/services/archive-uploader/
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-job-contracts/src/job-types.ts
  - packages/pixishelf-job-executors/src/archive/
  - packages/pixishelf-job-executors/src/maintenance/
---

# 归档收件箱

归档收件箱把 URL 采集、远端解析和媒体写入拆成可恢复的持久流程。管理员可以持续追加链接，无需等待上一条解析完成；已经就绪的项目可以随时多选并入队，每个作品仍对应一个独立归档任务并在媒体写通道中串行执行。

精确字段、状态和 payload 以 Prisma、Zod 与任务契约为准。本文说明用户流程、资源边界、生命周期和运维不变量。

## 页面与用户流程

| 页面                   | 职责                                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| `/admin/archive/inbox` | 批量追加 URL、管理发现来源、查看 FIFO 解析状态、修正、重试、取消与批量入队 |
| `/admin/archive`       | 服务端分页和筛选归档任务、查看明细、单项及当前页批量控制                   |

“添加链接”弹窗每次接受最多 100 行；服务端重新校验 URL、幂等键和活动收件容量。活动收件项目最多 1000 个。创建 submission 后请求立即返回，远端解析不占用浏览器或 Next.js 长连接。

收件项目平铺在全局 FIFO 中，submission 只标记一次提交和提供审计/筛选上下文，不形成必须等待全部完成的封闭批次。管理员可以在解析继续进行时选择 `READY` 项，按项目选择 `ORIGINAL` 或 `DISPLAY` 质量并批量入队。每项独立返回创建、复用、跳过、冲突或失败结果；重复命令通过持久幂等记录复用原结果。

解析结果区分新归档、更新、无变化、已有活动任务和重复来源身份。解析快照到期后不能直接入队，必须重新排队解析；修正失败 URL 会创建关联的新项目，不改写原审计历史。

同页的“发现来源”页签支持保存 E-Hentai 上传者名称或数字 UID，UID 是优先的稳定身份。来源不会定时扫描，也不会自动创建收件或下载任务；管理员只能手动执行“扫描最新”或在存在历史游标时“继续扫描更早内容”。每次最多持久化 100 条结果，并区分新归档、已有活动任务、已归档且未变化、可能更新和替代版本。只有新归档、可能更新和替代版本可由管理员勾选加入既有收件箱，之后仍经过 URL 解析、质量选择和显式归档入队。

上传者来源可以归档和重新启用，长期保留最新、增量和历史游标。扫描只有在完整成功后推进对应游标；失败、取消、暂停或 Worker 租约恢复不推进游标。扫描使用 `ARCHIVE_UPLOADER_SCAN@v1`，与 URL 解析共同占用 `ARCHIVE_RESOLVE` lane；E-Hentai 搜索请求保持三秒最小间隔并与下载共享 Provider penalty，但不会被活动下载 lease 阻塞。

任务页支持服务端 cursor 分页、状态/Provider/新建或更新/submission/文本筛选，以及 `PAUSE`、`RESUME`、`CANCEL`、`RETRY` 的当前页批量控制。批量命令逐项重新检查最新状态，不把部分冲突扩大成整批失败。回收、恢复、永久清理和 staging 清理仍走专用归档维护命令，不属于任务批量控制。

## E-Hentai 版本关系与归档身份

版本关系来自解析时 `gdata` 返回的上一版/当前版字段，不是解析与下载之间的前后差异比较，也不是实时更新通知。
仅存在上一版表示该画廊有历史版本；远端当前版 ID 与提交链接的画廊 ID 不同时，才表示解析时另有新版。
一个中间版本可以同时关联上一版和新版，不能因为发现上一版就把当前链接视为过时。

归档下载沿用已冻结的链接和媒体计划，不因版本关系自动切换目标或追加下载。若需要新版，管理员应另行添加新版链接、
解析并确认归档；不同画廊 ID 创建独立作品，双方存在时记录 `REPLACES` 关系，不覆盖、删除或合并旧作品。
这与同一 Provider/外部 ID 的快照更新是两种不同情况。

## 标题关键词来源

“发现来源”可切换上传者和标题关键词两类。关键词来源保存一个普通文本关键词，匹配方式默认为“包含”，也可选“开头是”或“结尾是”；可独立限定一个数字上传者 UID。名称可改，查询条件只能另存来源。规范化相同的查询复用原记录，不修改原名称或停用状态；停用来源可重新启用。

英/日标题分别忽略大小写、首尾空白后匹配，任一满足即可，保留标点、括号和内部空白。不运行用户正则。远端只构造受限的标题短语与可选 UID 查询；不能无歧义表达的双引号、星号、下划线、百分号及控制字符会明确报错，具体校验以共享 Zod 契约为准。

每次检查最多 **100 个去重远端候选**，不是收集 100 个匹配。界面分别显示检查数、匹配数及停止原因；零匹配仍可能有后续。进度依据过滤前候选计算，续扫游标绑定来源和冻结条件；扫描失败、取消或租约丢失不提交目录和游标。任务为 `ARCHIVE_SEARCH_SCAN@v1`，与上传者扫描复用请求治理和批量元数据，不逐画廊读取媒体详情。

只有当前匹配候选可见、计数及入箱；再次观察到不匹配时只隐藏本来源目录项，不删除其他来源、归档或媒体，不写全局忽略。入箱在全局身份锁下再次校验当前匹配及工作流，防止旧页面误提交。最终仍需人工勾选、收件解析、选择质量并归档；不新增定时扫描或自动下载。

覆盖范围仅限远端搜索实际返回的候选，不承诺全站任意文本检索，也不能靠最新水位自动补齐历史作品改标题后的命中。验证证据与待执行的生产发布门禁见[实施记录](../design/e-hentai-title-keyword-scan.md)。

## 持久状态与恢复

核心持久结构包括：

- `ArchiveIntakeSubmission` 与 `ArchiveIntakeItem`：保存输入、FIFO 顺序、解析状态、冻结结果、重试/取消 intent 和归档关联；
- `ArchiveBulkOperation` 与逐项结果：保存批量入队和任务控制的请求者、幂等键、目标与结果；
- `ArchiveUploaderSource`、`ArchiveUploaderScanRun` 与 `ArchiveUploaderScanItem`：保存上传者身份、双向游标、人工扫描状态、分类结果和收件关联；
- `SystemJob.executionLane`：把解析工作和所有媒体写工作映射到固定资源通道；
- Worker lease、heartbeat、attempt 与 `leaseToken`：为领取、进度和终态提供数据库执行围栏。

收件队列暂停只阻止领取下一项，不中断当前解析。取消当前解析使用持久 intent 和 cooperative abort；瞬时错误按退避策略重试并重新进入队尾。浏览器刷新、App 部署或 Worker 重启不会丢失 FIFO、attempt、暂停状态或已完成的批量结果。

## Worker 双通道

生产只有一个 `pixishelf-worker` 容器和进程，但它运行两个异步 Dispatcher loop：

| Lane                | 允许任务                                                               | 固定并发 |
| ------------------- | ---------------------------------------------------------------------- | -------- |
| `ARCHIVE_RESOLVE`   | `ARCHIVE_RESOLVE_ITEM`、`ARCHIVE_UPLOADER_SCAN`、`ARCHIVE_SEARCH_SCAN` | 1        |
| `BACKGROUND_WRITER` | 其余 26 类任务，包括归档下载                                           | 1        |

两个 lane 可以各推进一个任务；同一 lane 内不能并行。网络、数据库、文件流、Sharp/libvips 与 FFmpeg 子进程在等待时让出 Node.js 事件循环，因此链接解析可以在一个 writer 工作期间继续。该模型不承诺纯 JavaScript CPU 并行，也不开放 lane 并发。单个归档作品内部的媒体流并发可在系统设置中选择 1–8，并在每次启动、恢复或重试时冻结；运行中不能修改。

所有原媒体、派生媒体、staging、发布、扫描、迁移、替换和维护写操作都在 `BACKGROUND_WRITER` 全局串行。`ARCHIVE_RESOLVE` 的 Executor 契约只访问解析所需的远端数据和数据库，不执行媒体目录写入；两个 lane 仍共用同一 Worker 进程和 `rw` 挂载，因此这是队列/capability 边界，不是操作系统权限隔离。数据库按 lane 的执行态唯一索引与 `lane/archive-resolve`、`lane/background-writer` 资源租约共同防止滚动部署或误启动第二个 Worker 时出现同 lane 双执行。

生产 capability inventory 固定为 29 个 job type；`SCAN` 支持 v1/v2/v3，`ARCHIVE_IMPORT` 支持 v1/v2，其余 27 类只支持 v1，共 32 个
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

默认启用的 `archive_intake_retention_cleanup` 页面默认显示时间是 `02:15`，同样按中央统一窗口和优先级执行。终态收件项目、已完成批量操作、已完成/失败/取消的上传者扫描记录、无项目的旧 submission 和过期 `ArchivePreviewSession` 保留 30 天后分批清理。上传者来源身份和游标长期保留。该任务只删除操作历史和冻结预览，不删除 `ArchiveImport`、`SystemJob`、`Artwork`、`ArchiveRevision`、`Image` 或任何媒体文件。

归档任务页通过 admin layout 中唯一的通用 Worker SSE 连接接收生命周期与 `archive.transfer@v1` 遥测。速度由 Worker 在媒体流写盘时累计 chunk 长度并按最近 5 秒采样，不保存 chunk、也不回读磁盘。遥测还携带当前最多 8 个媒体 worker 的页码、预期文件名、尝试次数、阶段、已接收字节和可用时的 `Content-Length`，不携带图片页、CDN 地址或 provider token。页面在通道状态下方只为当前 `ARCHIVE_IMPORT` 展示聚合进度和逐文件活动槽位；历史任务行只保留稳定总进度，完整图片历史仍从 PostgreSQL 分页读取。SSE 正常时列表只做 30/60 秒一致性校准，图片明细在计数或状态变化时定向刷新；连接异常自动回退原有高频轮询。

## 权限与敏感数据

两个页面都需要 Better Auth Session。`archiveInbox`、`archiveUploader`、`archiveSearch` 和 `archive` 的读取使用 `authProcedure`，创建来源、扫描、来源归档/启用、结果入箱、暂停/恢复、取消、重试、批量入队和任务控制使用 `adminProcedure`；当前单一信任域中二者运行能力相同，但敏感写操作保留显式管理员语义。

服务端负责 URL/行数/容量上限、Provider HTTPS allowlist、DNS/redirect/SSRF 防护、响应体限制、状态 CAS 和幂等约束。普通列表、事件、日志和错误不得泄露 Cookie、Authorization、完整 locator、token 或 URL 路径中的敏感段；归档任务序列化统一执行脱敏。

## 运维不变量

1. 生产只有一个通用 Worker 服务，但允许一项解析与一项 writer 工作同时推进。
2. 任意时刻最多一个 resolver、最多一个 writer；媒体并发配置只作用于当前 writer 内的单个归档作品，不得增加第二个 writer。
3. lane migration 是旧 Worker 的回滚边界；迁移后不得启动不理解 lane 的消费者。
4. 切换前必须停止调度和写入者、通过专用只读 audit，并建立数据库、原媒体、派生媒体、配置和镜像 digest 的一致性检查点。
5. 迁移后的应用级隔离使用兼容双 lane schema 的 App/Worker 与 `false/false`；启动旧消费者只能通过恢复完整的切换前检查点。
6. 归档清理和永久删除只能由 writer lane 中的持久维护任务执行，不能用页面循环或手工删目录代替。

相关文档：

- [当前架构](../architecture/current-architecture.md)
- [后台任务业务链路](../architecture/background-job-business-flows.md)
- [历史归档默认标签补全](./archive-default-tag-backfill.md)
- [权限与接口边界](../security/access-control.md)
- [部署基线](../operations/deployment.md)
- [备份与恢复](../operations/backup-and-recovery.md)
- [ADR-0002](../adr/0002-use-a-durable-worker-and-atomic-archive-publication.md)
- [ADR-0004](../adr/0004-run-archive-resolution-in-a-separate-worker-lane.md)
- [ADR-0006](../adr/0006-freeze-database-configured-archive-media-concurrency.md)
- [ADR-0007](../adr/0007-stream-worker-job-events-over-a-persistent-cursor.md)
- [实现设计归档](../design/archive-intake-queue.md)
- [E-Hentai 上传者人工扫描设计](../design/e-hentai-uploader-manual-scan.md)
