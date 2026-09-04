---
status: current
scope: Prisma Schema 之外由 migration 实现的扩展、触发器、索引和维护约束
last-verified: 2026-09-02
sources:
  - schema.prisma
  - migrations/
---

# PixiShelf 数据库设计补充文档

本文档总结了 `schema.prisma` 中未体现，但通过 Migration 脚本 (`migrations/`) 直接应用到数据库中的核心逻辑、扩展和索引设计。这些逻辑对于保证数据一致性和查询性能至关重要。

## 1. 数据库扩展 (Extensions)

- **pg_trgm**: 启用了 PostgreSQL 的 Trigram 扩展。
  - **用途**: 实现高效的模糊字符串匹配（类似 `LIKE '%text%'` 但性能更好，且支持索引）。
  - **来源**: `migrations/20250906135951_enable_pg_trgm_extension`

## 2. 自动化业务逻辑 (Triggers & Functions)

为了保证数据一致性并减少应用层逻辑复杂度，部分统计字段由数据库触发器自动维护。**应用层代码无需（也不应）手动更新这些字段。**

### 2.1 标签作品计数 (`Tag.artworkCount`)

**机制**: 当 `ArtworkTag` 表发生记录插入、删除或标签变更时，数据库自动更新对应 `Tag` 的 `artworkCount` 字段。

- **触发器**:
  - `artwork_tag_after_insert_trigger`: 关联增加时，计数 +1。
  - `artwork_tag_after_delete_trigger`: 关联移除时，计数 -1。
  - `artwork_tag_after_update_trigger`: 标签变更时，旧标签 -1，新标签 +1。
- **语句级函数 (`update_tag_artwork_count`)**:
  - 使用 transition table 对单条 SQL 影响的标签先聚合，再执行集合式增量更新。
  - 采用原子 `UPDATE` 保证并发正确性，并包含负数保护。
  - 正常成功操作不写 `TriggerLog`；触发器异常会中止关联写入，交由 PostgreSQL 和应用日志记录。

### 2.2 作品点赞计数 (`Artwork.likeCount`)

**机制**: 当 `ArtworkLike` 表发生变化时，自动更新 `Artwork` 的 `likeCount`。

- **触发器**: `artwork_like_count_trigger` (监听 INSERT 和 DELETE 事件)。
- **函数**: `update_artwork_like_count()`。
- **初始化**: Migration 脚本中包含了一次性 SQL 用于校准现有数据的计数。

### 2.3 标签全文搜索 (`Tag.search_vector`)

**机制**: 为了支持高性能的多语言标签搜索，`Tag` 表维护了一个 `tsvector` 类型的列 `search_vector`（Schema 中定义为 `Unsupported("tsvector")`）。

- **触发器**: `tag_search_vector_update` (监听 BEFORE INSERT OR UPDATE)。
- **逻辑**: 自动将 `name`, `name_zh`, `name_en` 三个字段拼接并转换为向量：
  ```sql
  to_tsvector('simple',
      COALESCE(NEW.name, '') || ' ' ||
      COALESCE(NEW.name_zh, '') || ' ' ||
      COALESCE(NEW.name_en, '')
  )
  ```
  使用 `simple` 配置以避免语言特定的词干提取（Stemming），适合中英文混合环境及精确匹配需求。

### 2.4 作品图片计数 (`Artwork.imageCount`)

**机制**: 当 `Image` 表发生记录插入、删除或更新（修改归属作品）时，数据库自动更新对应 `Artwork` 的 `imageCount` 字段。

- **触发器**:
  - `artwork_image_count_trigger` (AFTER INSERT): 批量增加计数。
  - `artwork_image_count_delete_trigger` (AFTER DELETE): 批量减少计数。
  - `artwork_image_count_update_trigger` (AFTER UPDATE): 处理图片所属作品变更的情况（旧作品-1，新作品+1）。
- **优化**:
  - 采用 **语句级触发器 (FOR EACH STATEMENT)** 而非行级触发器，在批量操作时极大减少数据库 I/O 和锁竞争。
  - 逻辑封装在 `update_artwork_image_count()` 函数中。
- **初始化**: Migration 脚本中包含了全量校正 SQL。

## 3. 高级索引设计 (Advanced Indexes)

部分复杂索引无法在 Prisma Schema 中直接定义，或需要通过 Raw SQL 优化以获得最佳性能。

### 3.1 作品混合模糊搜索

- **索引名**: `artwork_title_description_trgm_idx`
- **定义**: `GIN ((title || ' ' || COALESCE(description, '')) gin_trgm_ops)`
- **用途**: 允许用户在一个搜索框中同时搜索标题和描述，且走索引查询。
- **注意**: Prisma Schema 中可能存在单独的 title/description 索引定义，但数据库层面实际生效且最高效的是这个复合 GIN 索引。

### 3.2 艺术家模糊搜索

- **索引名**: `Artist_name_idx`
- **定义**: `GIN (name gin_trgm_ops)`
- **用途**: 加速艺术家名字的模糊匹配查询。

### 3.3 艺术家外部身份

`20260825103000_add_artist_external_refs` 增加 `artist_external_refs`。身份唯一性由
`(providerKey, externalId)` 和 `(artistId, providerKey)` 两个唯一索引共同保证：同一外部账户不能归属多个
Artist，同一 Artist 在一个 Provider 下也不能同时保存多个身份。本地目录来源仍由 `LocalImportArtistMapping`
表达，不占用外部 Provider 身份。

迁移只回填“唯一数字 `Artist.userId` + 名下 Artwork 具有 Pixiv 外部引用”的强证据记录；重复数字 ID、没有
作品来源证据的数字 ID 和历史 `p_` ID 保持未认领。`Artist.userId` 在兼容发布周期内不删除，新写入逻辑以
`artist_external_refs` 为来源真值。

### 3.3 标签反查作品

- **索引名**: `ArtworkTag_tagId_artworkId_idx`
- **定义**: B-tree (`tagId`, `artworkId`)
- **用途**: 加速按标签反查作品、标签计数和删除标签关联；与现有 (`artworkId`, `tagId`) 唯一索引互补。

### 3.4 媒体类型筛选与候选索引

- 粗粒度“图片/视频”筛选读取 `Image.mediaType`，不在请求期间对 `path` 执行扩展名匹配。
- 新媒体入库时按扩展名写入 `IMAGE`、`VIDEO` 或 `ANIMATION`；历史 `UNKNOWN` 由“视频媒体探测”维护任务批量分类。
- `prisma/diagnostics/media-filter.sql` 提供生产只读分布检查以及 `EXPLAIN (ANALYZE, BUFFERS)`。
- (`artworkId`, `mediaType`) 与 (`artworkId`, `sortOrder`, `id`) 目前仅为候选索引。只有生产执行计划证明现有单列/唯一索引不足时才创建，避免增加无依据的写入和存储成本。
- 历史字段 `Image.webpAnimationStatus` 继续作为动画内容探测状态使用，现覆盖 WebP、GIF、PNG/APNG；探测任务同时把 `mediaType` 纠正为 `IMAGE` 或 `ANIMATION`。
- `MediaVideoMetadata.hasAudio` 表示 FFmpeg 实测存在可听内容，不表示容器仅存在音频流。阈值固定为 `max_volume > -50 dB`。
- `MediaChapterPreview.hasAudibleAudio` 保存章节级可听结果；`audioChaptersHash` 将结果绑定到章节清单，避免仅补音频时把旧截图错误标成当前；`audioProbeError` 保存失败原因。三个字段均可空，以兼容旧清单和滚动部署。
- 章节 API 只在 `audioChaptersHash` 匹配当前清单时使用数据库结果。未校准或失败的 v1/v2 音频声明按未知处理；v3 清单可作为初始值，当前 hash 的数据库实测拥有最高优先级。

### 3.5 后台任务队列与执行 lane 索引

- `system_jobs(executionLane, status, effectivePriority, availableAt, createdAt)` 是按 lane 的领取索引；优先级越小越先执行。
- `system_jobs_single_executing_per_lane_idx` 是执行态部分唯一索引，保证 `ARCHIVE_RESOLVE` 与 `BACKGROUND_WRITER` 各自最多一条 `RUNNING/PAUSING/CANCELLING` 记录。它允许一项 resolver 和一项 writer 同时执行，但不允许同 lane 双执行。
- `system_jobs_type_execution_lane_check` 固定 job type 到 lane：`ARCHIVE_RESOLVE_ITEM`、`ARCHIVE_UPLOADER_SCAN` 与 `ARCHIVE_SEARCH_SCAN` 进入 `ARCHIVE_RESOLVE`，其他任务全部进入 `BACKGROUND_WRITER`。
- `system_jobs(status, deadlineAt)` 用于自动窗口过期，`system_jobs(status, leaseExpiresAt)` 用于崩溃租约恢复。
- `system_jobs(scheduledTaskId, scheduledForDate)` 唯一约束防止每日计划重复物化；`system_jobs(idempotencyKey)` 为可空 API 幂等键。
- `system_job_events(jobId, id)` 支持按全局递增游标读取单任务时间线。
- `derived_media_gc_entries(status, notBefore, createdAt)` 支持延迟、小批量领取删除意图；`(mediaKind, relativePath)` 唯一约束用于安全 upsert。
- `worker_instances(status, heartbeatAt)` 支持在没有任务运行时仍判断独立 Worker 的就绪状态与心跳新鲜度；它不依赖 `system_jobs.workerId`，因此空闲 Worker 也有可观测记录。
- 未增加 `targetImageId` 新索引。兼容列的查询收益需要生产执行计划证明后再单独处理，避免无依据增加写放大。

### 3.6 高风险任务的冻结输入与增量检查点

扫描、本地目录导入、目录迁移和批量替换会同时修改数据库与媒体目录。它们不能依赖内存游标恢复，也不能把数千条输入直接塞入 `system_jobs.payload`。`20260815010000` 先提交旧枚举扩展，`20260815011000` 再建立以下纯增量结构：

| 领域           | 持久结构                                                             | 关键字段/约束                                                                                                                             | 恢复语义                                                                                                    |
| :------------- | :------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| 扫描主记录     | `scan_runs`                                                          | `systemJobId` 可空唯一；`inputDigest/inputCount/inputFrozenAt`；`checkpointStage/checkpointOrdinal`；`startedAt` 可空                     | payload 只保存模式与输入摘要；Worker 从冻结表和 ordinal 恢复，不重新读取请求输入                            |
| 扫描单项       | `scan_run_items`                                                     | 可空 `checkpointKey` 与 `(scanRunId, checkpointKey)` 唯一；`attempt >= 0`                                                                 | 历史项允许 key 为 null；新 Executor 用稳定 key 对终态 upsert，PostgreSQL 允许唯一索引中存在多个 null        |
| 客户端列表输入 | `scan_run_metadata_inputs`                                           | `(scanRunId, ordinal)`、`(scanRunId, relativePath)` 双唯一；可选内容 SHA-256                                                              | CLIENT_LIST 在领取前冻结相对路径和内容指纹                                                                  |
| 本地导入输入   | `scan_run_local_work_inputs`、`scan_run_local_artist_mapping_inputs` | 稳定 ordinal；work 的 kind/path 唯一；artistDirectory 唯一                                                                                | 冻结发现结果和当时的 artistId 映射；artistId 是快照，故意不建 Artist FK，避免后续删改改变原任务含义         |
| 批量替换操作   | `pending_replace_operations`                                         | `systemJobId` 主键；batch/item 外键为 `RESTRICT`；RESTORE 必须有 itemId；复合 FK `(itemId,batchId)` 保证 item 属于同一 batch              | 一个中央任务只绑定一个明确操作；领域记录不能在任务仍引用时被级联删除                                        |
| 目录迁移项     | `migration_job_items`                                                | `(systemJobId, artworkIdSnapshot)` 唯一；状态、阶段、attempt、源/目标 fingerprint                                                         | 每个作品独立恢复；`artworkIdSnapshot` 是冻结选择，不建 Artwork FK，不因作品后续删除而抹掉审计               |
| 目录迁移文件   | `migration_file_entries`                                             | `(itemId, ordinal)`、`(itemId, sourceRelativePath)`、`(itemId, targetRelativePath)` 三重唯一；源/staging hash、size、mtime 和三个提交时间 | 文件先进入 attempt staging，校验后发布数据库，最后按 fingerprint 清理源；`ACTION_REQUIRED` 保留人工恢复证据 |

`FULL_RECONCILE` 已退出 `SCAN@v1` payload contract 和 Worker executor。历史 `ScanRunMode.FULL` 与终态
`FULL_RECONCILE` 任务不会被删除或改写，DTO 和管理页面继续把它们作为已停用历史展示；发布前只读数据库审计要求
所有非终态 FULL 任务在安装新 Worker 前完成或由管理员取消。`ArtworkExternalRef.lastSeenScanRunId` 及既有索引继续作为
历史兼容字段保留，本次代码 contract 清理不混入物理删列或删索引 migration。

`20260820120000_add_pixiv_metadata_inventory` 以 expand-only 方式增加 Pixiv metadata inventory：

- `pixiv_metadata_inventory_state` 是 `id='pixiv'` 的单例，绑定 resolved scan root 的 SHA-256，并记录首次可信
  baseline 的 generation 与完成状态；不同根目录不能共享 inventory。
- `pixiv_metadata_inventory` 以 `relativePath` 唯一，保存 size/mtime、可用时的 ctime/device/inode、观测 hash、已
  发布 hash、最近尝试和可恢复错误。它不拥有 Artwork，`externalRefId` 删除时只置空。
- `baselineEligible` 只表示某行来自首次完整遍历的候选；只有相同 generation 的全局状态到达 `READY` 后才能被
  消费，部分页面提交或取消不能提前建立基线。
- `lastErrorRetryable=false` 只缓存由相同内容确定的永久 metadata 错误；可重试错误写 `true`，不由内容决定的终态
  冲突写 `null`，从而允许后续 ScanRun 在外部状态修复后重新判断。
- `scan_run_metadata_inputs` 冻结相同 stat 字段；`scan_runs` 新增可空工作量和阶段耗时。升级前历史行保持 `null`，
  `ScanRunItemAction` 没有扩枚举，旧客户端可以继续读取和写入旧字段集合。

普通增量只在 stat/失败状态要求时 hash，发布领域记录与推进 `processedContentHash` 使用同一 fenced transaction。
migration 对既有表的值域约束采用 `NOT VALID` 后再显式 `VALIDATE`，避免在加约束语句本身混入不可控历史改写。

`20260820200000_add_pixiv_source_audit` 继续以 expand-only 方式增加来源一致性核对的持久底座：

- `scan_runs.operationKind` 区分普通扫描与 `CONSISTENCY_AUDIT` / `AUDIT_APPLY`，四个可空分类计数只为新核对
  记录提供聚合；历史 ScanRun 和旧写入者可以继续保留 `null`。
- `pixiv_source_audit_items` 保存 `NEW / CHANGED / MISSING / INVALID / IDENTITY_CONFLICT` 差异。它只把
  `scanRunId` 建成级联外键；inventory、external ref 和 Artwork ID 都是核对时的证据快照，不跟随后续领域行
  删除或改名，也不能被解释为新的所有权关系。
- `scan_run_metadata_inputs` 增加来源核对项、差异类型和预期身份快照。`auditDifferenceKind` 同时作为逐输入持久
  checkpoint；成功分类为 `UNCHANGED` 的输入不写明细行，避免稳定目录产生万级报告噪声。
- inventory state 除 resolved root 的路径 hash 外，还保存可用时的 root device/inode；inventory 行使用独立的
  `lastSeenAuditRunId` 记录本轮核对是否见到，不能复用普通发现的 `lastSeenScanRunId`。

一致性核对只写 ScanRun、冻结输入、inventory 观测和差异明细，不写 `Artwork`、`Image`、
`ArtworkExternalRef`、标签、Source Snapshot 或原媒体。只有完整、非空、未达到遍历上限、输入 count/digest 与
root 身份均再次验证通过，并且仍持有任务 fence 时，finalizer 才能把本轮未见 inventory 分类为 `MISSING`；取消、
失败、空目录、遍历截断或 root 变化均不得生成 `MISSING`。`MISSING` 只是报告，不自动解绑或删除领域数据。

`20260820210000_add_pixiv_source_audit_apply` 继续保持 expand-only，为选定同步增加可空证据与结果列：

- `scan_runs.sourceAuditRunId` 保存 apply 所依据的核对 ID；它故意不建可变领域外键。stale/conflict 聚合只在
  `AUDIT_APPLY` 上使用，旧 ScanRun 保持 `null`。
- `scan_run_metadata_inputs` 补齐核对时观测的 external ID 与预期已发布 hash，连同既有 path、内容 hash、stat、
  inventory/ref/Artwork ID 组成 v3 的冻结 CAS 证据。
- `scan_run_items` 保存核对项 ID、`NEW / CHANGED`、`APPLIED / SKIPPED / CONFLICT / FAILED`、安全原因码、是否
  可重试和结果 Artwork ID；约束要求非 apply 行整组为空、apply 终态结果完整，每个 operation 对同一核对项唯一。
- 上述证据 ID 均不建立到当前 inventory、Source Reference、Artwork 或 audit item 的外键，避免后续领域删改
  篡改历史任务含义；一致性由入队冻结、canonical digest、领取验证和 fenced publish 共同保证。

普通扫描和 `AUDIT_APPLY` 现在共用的 Pixiv publisher 会把冻结 metadata 内容 hash 写入
`ArtworkExternalRef.metadataHash`，并按 `(externalRefId, metadataHash)` upsert 不可变 `ArtworkSourceSnapshot`，
保存规范化与原始来源证据。刷新仍保留本地 override、既有 Artist、非当前来源标签和媒体顺序，不因来源缺项删除
Image。apply 的 stale 或身份冲突在这些领域写入之前终止。

`ScanRun` 保留清理按核对证据组运行：共享 SCAN advisory lock 后，任何非终态 apply 都阻止父核对删除；只有父
核对本身符合年龄/数量策略且所有 apply 均终态时，父核对与关联终态 apply 才在同批事务中删除。直接取消未领取
的 v3 job 也必须在同一事务中终态化 SystemJob、apply ScanRun 与每个未完成 ScanRunItem。

`20260815010000` 与 `20260815011000` 都使用显式事务。后者的第一项业务语句是只读 guard：若旧
`scan_runs.systemJobId` 重复，或同一 pending batch 中 `sourceDirectoryName` 重复，migration 明确失败且不选择
任意赢家。新结构不更新或删除 `Artwork`、`Image` 及其媒体引用。

Phase 5 将上述四类高风险任务接入通用 Worker 后，生产 Registry 曾为 17 项 v1 capability。归档收件箱增加 `ARCHIVE_RESOLVE_ITEM`、复用/扩展 `ARCHIVE_MAINTENANCE`，并增加 `ARCHIVE_INTAKE_RETENTION_CLEANUP` 后，Registry 曾达到 20 个 job type。加入 Pixiv 标签、艺术家补全与作品在线同步后曾为 23 个 job type，加入 `PIXIV_AI_DERIVED_TAG_SYNC` 后曾为 24 个 job type，加入 `PIXIV_SERIES_RECONCILIATION` 后曾为 25 个 job type，加入 `ARCHIVE_DEFAULT_TAG_BACKFILL` 后曾为 26 个 job type；当前增加 `ARCHIVE_UPLOADER_SCAN` 和 `ARCHIVE_SEARCH_SCAN` 后为 28 个 job type。`SCAN` 同时注册 v1/v2/v3，`ARCHIVE_IMPORT` 注册 v1/v2，其余 26 类仍只注册 v1，因此共有 31 个 job type/definition-version 组合。SCAN v1 承载既有扫描，v2 只读核对，v3 选定写入；ARCHIVE_IMPORT v1 兼容历史空默认标签任务，v2 冻结归档默认标签；滚动部署中的旧 Worker 不会领取它不支持的新版本。`WorkerInstance.capabilities` 保存实际 Registry 快照，部署门禁精确比较 job type、definition version 和 lane；任务执行授权仍由 `SystemJob.definitionVersion`、领取事务和 `leaseToken` 栅栏决定。

### 3.7 归档收件与 Provider 请求治理

`20260818120000_add_archive_intake_worker_lanes` 在同一次协调切换中增加收件持久结构和执行 lane：

| 结构                              | 语义与关键约束                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `archive_intake_submissions`      | 一次添加操作；幂等键唯一，计数字段受 CHECK，后续增加固定长度请求 hash          |
| `archive_intake_items`            | 全局 FIFO 项；`queueOrder` 唯一，活动 URL hash 和 Provider identity 有条件唯一 |
| `archive_bulk_operations` / items | 批量入队/控制的持久命令与逐项目标结果；幂等键及目标组合唯一                    |
| `archive_resolve_queue_control`   | 单例暂停 intent 与审计时间，不依赖浏览器内存                                   |
| `archive_provider_throttles`      | 跨 lane、跨重启保存 Provider 下一请求时间和 penalty                            |
| `archive_provider_request_leases` | 协调解析与下载的 Provider 请求预算和过期租约                                   |

lane migration 的第一组业务语句是只读 guard：存在 `RUNNING/PAUSING/CANCELLING` 的 `SystemJob`，或存在未过期的 `global/background-worker` lease 时立即失败且不执行 DDL。所有既有任务通过新列默认值成为 `BACKGROUND_WRITER`；过期旧全局 lease 在 guard 后删除。迁移替换全局执行唯一索引，因此应用后不得再启动不理解 lane 的旧 Worker。

`20260818170000_add_archive_operation_request_hashes` 为 submission 和 bulk command 增加请求 hash，使同一幂等键只有请求内容完全一致时才可重放。`20260818180000_add_archive_maintenance_worker_job` 增加维护任务必须位于 writer lane 的命名 CHECK。`20260818190000_add_archive_intake_retention_cleanup` 为已完成批量操作的 30 天清理增加索引；实际清理由有围栏的 writer job 分批执行，不通过级联关系删除 `SystemJob`、归档领域实体或媒体。

`20260902120000_add_archive_uploader_manual_scan` 增加上传者来源、人工扫描运行和逐项候选表，并把 `ARCHIVE_UPLOADER_SCAN` 加入 `ARCHIVE_RESOLVE` lane。来源持久保存最新、增量和历史游标；运行只有在 fenced completion 中推进游标。`SEARCH` 请求与媒体下载可以并行，但仍共享 `archive_provider_throttles` 的请求间隔和 penalty；普通 `RESOLVE` 继续在活动下载 lease 存在时让行。

`20260904120000_add_archive_uploader_uid_binding` 为上传者来源增加独立的稳定数字 UID 和覆盖复核时间，并为每个扫描运行冻结实际使用的 `NAME/UID` 查询身份。已有 UID 来源原地回填且保留水位；名称来源保持未绑定。名称绑定或 UID 更正只重置来源查询水位、游标和摘要，不删除长期目录、运行历史或工作流关联；重新发现继续按来源、Provider 和 GID upsert。迁移在 DDL 前拒绝活动上传者扫描，并以 `(providerKey, uploaderUid)` 唯一索引阻止跨来源重复绑定。

`20260904180000_add_archive_title_search` 是事务化 expand migration：保留原表名、记录 ID、关系、上传者 UID、水位和目录，增加来源类型、JSON 查询、查询指纹、运行检查/匹配计数及候选匹配标记。旧数据默认为 `UPLOADER` 和匹配；不重建或迁移整套模块。

标题来源的 UID 限制只存于查询 JSON，上传者身份列必须为空；数据库 CHECK 约束来源/运行形状和检查计数边界。指纹以 Provider、规范化关键词、匹配方式和 UID 范围计算并唯一约束；冻结条件不能通过重命名更新。目录仍以来源/Provider/GID 唯一，跨来源处置仍以 Provider/GID 全局锁串行化。入箱与计数忽略 `matchesQuery=false`，但保存该来源的原目录身份及工作流关系。

迁移先拒绝任何非终态发现扫描，再执行 DDL；此 guard 不代替停止旧写入者。增加来源类型后旧版 App 不兼容混合来源，不能直接二进制降级。完整回滚恢复数据库/媒体/配置/镜像一致性检查点；优先前向修复或在兼容版本停用标题来源。

## 4. 审计与维护 (Audit & Maintenance)

### 4.1 后台任务切换守卫与手写约束

`20260814091000_add_background_task_queue_schema` 使用显式事务，事务内第一条业务语句是只读 `DO` 守卫。它在任何 DDL、回填或索引创建前检查旧任务、归档导入、扫描、批量替换、视频探测/封面/章节/关键帧和归档生命周期共 12 类活动状态。关键帧 `STAGING` 集合在任务引用为空、关联任务缺失或关联任务非终态时也会阻断。发现阻断项时 migration 只报错并退出，不会替业务数据“收口”。该守卫是停机流程的第二道防线，不是并发写屏障；执行 migration 前仍必须按 Runbook 停止全部旧写入者。

该 migration 不更新或删除 Artwork、Image、媒体、归档、扫描、替换等领域记录；只回填旧 `system_jobs` 和 `scheduled_tasks` 的队列兼容字段。旧任务被标记为 `definitionVersion=0`、`triggerSource=LEGACY`，不补造事件或 GC 删除意图。

以下数据库约束由 migration 手写，因为 Prisma schema 不能表达 `CHECK`：

- `system_jobs.progress` 必须为 0–100，`attempt >= 0`、`maxAttempts >= 1`、`definitionVersion >= 0`。
- `system_job_events.progress` 为空或为 0–100。
- `derived_media_gc_entries.attempt >= 0` 且 `maxAttempts >= 1`。

`system_jobs` 是历史表，切换审计并不读取每条旧记录的 progress/attempt。它的四个 CHECK 首次以 `NOT VALID` 创建：创建时不扫描未触碰的历史行，但会立即约束新插入，也会校验之后被更新的旧行（即使只更新无关字段）。这样可避免未知旧历史值在创建约束时扩大停机风险。部署后的兼容审计应先报告并修复异常旧值，再在独立 migration 中执行 `VALIDATE CONSTRAINT`。新建的事件和 GC 表为空，因此其 CHECK 在创建时直接验证。

本兼容阶段为 `system_jobs.availableAt` 回填值并增加 `CURRENT_TIMESTAMP` 默认值，但暂不设置 `NOT NULL`：旧关键帧入口仍会显式写 `NULL`，并把它解释为“立即可领取”。严格租约全有/全空、`SKIPPED` 字段一致性、计划字段成对约束及 `availableAt NOT NULL`，统一延后到旧执行入口完全迁走后的清理 migration，避免破坏停机升级后的回滚能力。

### 4.2 触发器日志 (`TriggerLog`)

- **用途**: 记录人工一致性修复等维护摘要；不再记录每条成功的 `ArtworkTag` 变更。
- **表结构**: 包含 `operation` (INSERT/UPDATE/DELETE), `table_name`, `old_value`, `new_value`, `error_message` 等字段。
- **保留策略**: 默认保留 30 天，由 `trigger_log_retention_cleanup` 每日计划任务清理；该任务首次创建时默认启用。

### 4.3 维护函数

数据库内置了以下维护函数，可在必要时（如直接操作数据库导致计数偏差后）手动调用：

| 函数名                            | 描述                                                                                            |
| :-------------------------------- | :---------------------------------------------------------------------------------------------- |
| `check_tag_count_consistency()`   | 检查所有标签的 `artworkCount` 与实际 `ArtworkTag` 数量是否一致。返回不一致的 Tag 列表及预期值。 |
| `fix_tag_count_inconsistencies()` | 一次聚合并集合式修复所有不一致的标签计数，只写一条维护摘要日志。                                |
| `cleanup_trigger_logs()`          | 清理 30 天前的触发器日志，防止日志表无限膨胀。                                                  |

## 5. Migration 文件对照参考

| Migration ID     | 关键内容                                                                                                                                        |
| :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| `20250906135951` | 开启 `pg_trgm`，创建 Artwork Title+Description 混合 GIN 索引                                                                                    |
| `20250929092056` | 创建 `TriggerLog` 表，添加 Tag 计数触发器 (`ArtworkTag`) 与维护函数                                                                             |
| `20250929103727` | 添加 Tag 搜索向量列 (`search_vector`) 及基础更新触发器                                                                                          |
| `20251001054605` | 更新 Tag 搜索触发器以支持 `name_en` (多语言搜索)                                                                                                |
| `20251003034237` | 添加作品点赞计数触发器 (`ArtworkLike`)                                                                                                          |
| `20260203000000` | 添加作品图片计数触发器 (`Artwork.imageCount`, 语句级优化)                                                                                       |
| `20260227003621` | 重构认证系统 (BetterAuth)，User -> UserBA，并清理无效 ArtworkLike 数据                                                                          |
| `20260808000000` | 添加 `ArtworkTag(tagId, artworkId)` 索引，将标签计数改为语句级集合更新，并清理重复日志索引                                                      |
| `20260814090000` | 独立新增后台任务来源/跳过/事件/GC 枚举，并扩展 `JobStatus`，避免同事务使用新枚举值                                                              |
| `20260814091000` | 先执行只读切换守卫，再新增持久队列字段、事件/资源租约/派生媒体 GC 表、索引、外键和安全 CHECK，并回填旧任务兼容标记                              |
| `20260814100000` | 新增独立 Worker 实例状态枚举、心跳表及状态/心跳索引；纯增量建表，不改写旧数据                                                                   |
| `20260814110000` | 在确认无旧执行态任务后，新增执行态部分唯一表达式索引，作为全局单并发的数据库最终栅栏                                                            |
| `20260815001000` | 新增视频封面 backlog 公平游标及探测/封面复合索引；复合索引显式映射为 `MediaVideoMetadata_poster_backlog_idx`，避免 PostgreSQL 63 字节标识符截断 |
| `20260815010000` | 在独立事务中扩展扫描运行、扫描单项、批量替换 batch/item 的暂停、重试和恢复状态；不混入结构 DDL                                                  |
| `20260815011000` | 为四类高风险任务新增冻结输入、单项/文件检查点、批量替换操作绑定、迁移阶段状态、约束和恢复索引；部署前拒绝重复旧 ownership 数据                  |
| `20260818120000` | 守卫执行态和旧全局 lease，增加双 lane、按 lane 唯一执行索引、持久收件/批量审计/Provider 限流结构及外键                                          |
| `20260818170000` | 为归档 submission 与 bulk operation 增加请求 hash 和长度 CHECK，确保幂等键重放不会接受不同请求                                                  |
| `20260818180000` | 验证 `ARCHIVE_MAINTENANCE` 只能位于 `BACKGROUND_WRITER`                                                                                         |
| `20260818190000` | 为 30 天收件历史保留清理增加已完成批量操作时间索引                                                                                              |
| `20260820200000` | 以 expand-only 方式增加来源核对 operation/count、冻结证据、root dev/inode、独立 sighting marker 和持久差异明细；不改写领域或媒体数据            |
| `20260820210000` | 为来源核对选定同步增加父核对证据、冻结 CAS 字段、逐项 outcome/reason/retryable、完整性 CHECK 和恢复/查询索引；历史行保持兼容                    |
| `20260825103000` | 增加艺术家多 Provider 外部身份、同步状态与 Pixiv 强证据回填；保留旧 `Artist.userId` 作为一个发布周期的回滚镜像                                  |
| `20260826143000` | 为 Pixiv 作品外部引用增加在线同步状态、任务与磁盘快照指针；只在唯一来源及数据库快照精确匹配时清除误标文本 override                              |
| `20260902120000` | 增加 E-Hentai 上传者来源、人工扫描运行与候选结果，扩展 SEARCH 请求类，并允许上传者扫描进入 `ARCHIVE_RESOLVE` lane                               |
| `20260904120000` | 增加 E-Hentai 上传者稳定 UID、UID 覆盖复核状态与扫描运行查询身份快照；既有 UID 来源原地回填且不重置扫描水位                                     |
