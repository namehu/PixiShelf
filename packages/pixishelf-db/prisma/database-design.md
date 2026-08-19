---
status: current
scope: Prisma Schema 之外由 migration 实现的扩展、触发器、索引和维护约束
last-verified: 2026-08-19
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

### 3.5 后台任务队列与执行 lane 索引

- `system_jobs(executionLane, status, effectivePriority, availableAt, createdAt)` 是按 lane 的领取索引；优先级越小越先执行。
- `system_jobs_single_executing_per_lane_idx` 是执行态部分唯一索引，保证 `ARCHIVE_RESOLVE` 与 `BACKGROUND_WRITER` 各自最多一条 `RUNNING/PAUSING/CANCELLING` 记录。它允许一项 resolver 和一项 writer 同时执行，但不允许同 lane 双执行。
- `system_jobs_type_execution_lane_check` 固定 job type 到 lane：只有 `ARCHIVE_RESOLVE_ITEM` 可以进入 `ARCHIVE_RESOLVE`，其他任务全部进入 `BACKGROUND_WRITER`。
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

`SCAN` payload 的 `FULL_RECONCILE` 映射到既有 `ScanRunMode.FULL`，而不是再增加一组含义重复的数据库枚举。
它现在仅是 compatibility-only 的历史任务值：App 不存在新 producer，通用入队与人工重试也拒绝该
payload。历史 `ScanRunMode.FULL` 和已存在的 `FULL_RECONCILE` 记录不会被删除或改写；活动任务仍可读取、
控制、执行和租约自动恢复，但不能人工复制或重试为新任务。

仅对这些已存在的兼容任务，Executor 在领取前记录 `inputFrozenAt`，处理每个 provider reference 时写
`ArtworkExternalRef.lastSeenScanRunId`。只有所有冻结输入都成功后，才允许按
`providerKey + createdAt <= inputFrozenAt + (lastSeenScanRunId IS NULL OR lastSeenScanRunId <> currentRun)`
清扫旧引用；显式包含 `NULL` 是为了让升级前从未写入 marker 的历史引用也能被正确对账。失败、暂停或重试不得
执行 sweep。`artwork_external_refs_reconcile_sweep_idx(providerKey, createdAt, lastSeenScanRunId)` 与该有界
查询一致，单列 marker 索引则保留用于诊断。

两条新 migration 都使用显式事务。结构 migration 的第一项业务语句是只读 guard：若旧 `scan_runs.systemJobId` 重复，或同一 pending batch 中 `sourceDirectoryName` 重复，migration 明确失败且不选择任意赢家。新结构不更新或删除 `Artwork`、`Image` 及其媒体引用。

Phase 5 将上述四类高风险任务接入通用 Worker 后，生产 Registry 曾为 17 项 v1 capability。归档收件箱增加 `ARCHIVE_RESOLVE_ITEM`、复用/扩展 `ARCHIVE_MAINTENANCE`，并增加 `ARCHIVE_INTAKE_RETENTION_CLEANUP` 后，当前 Registry 为 20 项 v1。`WorkerInstance.capabilities` 保存实际 Registry 快照，部署门禁精确比较 job type、definition version 和 lane；任务执行授权仍由 `SystemJob.definitionVersion`、领取事务和 `leaseToken` 栅栏决定。

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
