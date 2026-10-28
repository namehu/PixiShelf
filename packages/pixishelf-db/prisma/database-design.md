---
status: current
scope: Prisma Schema 之外由 migration 实现的扩展、触发器、索引和维护约束
last-verified: 2026-10-22
sources:
  - schema.prisma
  - migrations/
---

# PixiShelf 数据库设计补充文档

## 归档删除意图

`20261012160000_archive_deleted_identities` 增加独立来源身份删除表及归档任务历史删除字段。`artwork_preserve_archive_deletion` 在作品生命周期更新和删除前原子保存/解除删除意图；`archive_import_clear_published_deletion` 仅在成功发布时解除对应身份的删除标记。表不引用 Artwork 或发现来源，永久清理不级联移除删除意图。迁移还创建正常任务和回收站分页的部分索引；这些部分索引不能完整表示在 Prisma Schema 中。保留期及文件操作仍由服务/Worker 负责，触发器不操作文件。完整生命周期、回填边界和回退要求见[归档回收站](../../../docs/features/archive-trash.md)。

本文档总结了 `schema.prisma` 中未体现，但通过 Migration 脚本 (`migrations/`) 直接应用到数据库中的核心逻辑、扩展和索引设计。这些逻辑对于保证数据一致性和查询性能至关重要。

## 作品浏览索引

`20261016090000_artwork_browse_indexes` 创建仅覆盖未删除且 ACTIVE 作品的 `artwork_active_random_v1_idx`，表达式为 `md5(id::text || ':artwork-random-v1') COLLATE "C"`，以 id 决胜。它不能完整表示在 Prisma Schema 中，SQL migration 和查询构造器必须保持表达式／排序规则一致。另建 `Image_artworkId_sortOrder_id_idx`，用于数据库内每作品 LIMIT 1 的封面读取。两者为增量索引，不回填业务数据；普通创建期间需停写，回退旧应用可保留。详见[性能与部署边界](../../../docs/architecture/artwork-feed-query-performance.md)。

## Artwork 阅读版本与进度约束

`20260924130000_add_artwork_reading_tracking` 为既有 Artwork 加入 `mediaRevision INTEGER NOT NULL DEFAULT 1`，数据库约束要求版本至少为 1；它不回填历史阅读。`artwork_reading_summaries` 使用 `(userId, artworkId)` 主键，保存访问次数、逻辑媒体进度快照和最后位置；`artwork_read_media` 使用 `(userId, artworkId, mediaId)` 主键，避免同一账户重复计入同一 Image。摘要计数约束要求 `0 <= seenCount <= totalCount` 且访问次数非负，最后序号不能为负。账户与作品删除级联清理两表；媒体删除级联清理已读成员，摘要的 `lastMediaId` 置空。

最近阅读索引为 `(userId, lastViewedAt DESC, artworkId DESC)`；两表均有按 artworkId 的索引用于重建失效清理，摘要的 lastMediaId 和已读表的 mediaId 也有外键查询索引。阅读状态由服务层在完整逻辑媒体映射上计算，数据库原始 Image 行数不直接代表总进度。普通媒体增删、排序由写入者先锁 Artwork 再写 Image，不更改版本或清空访问次数；完整重建由 App/Worker 在原发布事务中先锁 Artwork、递增版本并清空两表。此锁序还避免阅读上报持有 Artwork 行锁后触及 Image 外键、与媒体写入形成反向等待。旧版本应用回滚期间须暂停完整重建写入者；恢复边界见[备份与恢复](../../../docs/operations/backup-and-recovery.md)。

## 单图书签与喜欢 (`MediaMark`)

`20261022160000_media_marks` 新增独立标记表，不更改 `ArtworkLike` 或阅读数据。`bookmarkedAt` 与 `likedAt` 各自可空，CHECK 要求至少一个非空；逻辑媒体序号必须大于零，类型限定图片、动画和视频。有效媒体按 `(userId, mediaId)` 唯一，媒体引用置空后允许保留多条不同的失效记录。按账户、对应时间倒序及 ID 排序的索引服务两个分页集合。

账户与作品外键使用 `Cascade`，Image 外键使用 `SetNull`。Image 删除时保留标记 ID、时间及作品名／序号／类型快照；正常扫描和排序沿用 Image ID。应用内同 ID 原件覆写通过既有写入状态及作品锁，在成功收尾事务中断开标记引用；替换回滚保留。数据身份不依赖文件名、数组序号、派生图或内容哈希。用户规则及回退限制见[单图书签与喜欢](../../../docs/features/media-marks.md)。

## 原媒体内容证据与写入声明

局部核验日期：2026-10-23，适用于去重开发分支。`20261023002000_media_content_fingerprints` 新增文件/作品源状态、文件/作品指纹、目录代次和路径写入声明；`20261023003000_media_content_recovery_grants` 新增离线恢复授权。两次迁移只创建数据库结构及约束，不读取媒体、不回填历史哈希；阶段验收状态见[隔离验证记录](../../../docs/records/artwork-deduplication-phase-1-2026-10-23.md)。

Image 的增删及内容相关路径/大小/归属更新通过语句级触发器推进相关源代次；纯标题与排序变化不使内容缓存失效。同 ID 文件覆写由写入口显式声明，数据库触发器不能观察文件系统。完整替换推进作品 epoch，单媒体变更推进受影响源状态；源代次单调递增，不能恢复旧代次来重用旧证据。版本、大小和高精度文件属性使用 BIGINT。

没有 Image 的新上传同样需要路径声明。目录与路径按受管根命名空间定位，开始/结束写入推进目录及祖先代次；扫描不能略过写入中路径后发布不完整成员。业务发布在短事务内检查持有者、token、声明版本、源代次和执行租约，并与声明结束一同提交。文件读取、哈希与文件搬移在事务外完成，文件系统和数据库没有共同事务。

文件与作品指纹是可重建缓存，随媒体/作品级联清理；尚未结束的路径声明及恢复授权是操作状态，不能当缓存删除。根身份变化、旧执行或不确定文件结果都保留声明。恢复授权绑定原 job、会话、精确声明和下一 attempt，不表示文件已经恢复，也不能替代原领域的文件核验。精确数据访问与锁顺序以 `src/media-content-*.ts`、SQL migration 和[阶段契约](../../../docs/design/artwork-deduplication/phase-1-contracts.md)为准。

## 去重检测的持久范围与读取占用

局部核验日期：2026-10-23，适用于去重开发分支。04000/04100/04200 三个正式迁移建立 ArtworkDedupRun、Item、Media、Group、GroupMember、Command 及根绑定；不扫描原媒体、不回填哈希。Item 冻结有效创作者归属下的作品与版本，Media 分页保存可靠属性和读取证据，GroupMember 保存精确多重集合分组结果，不建立两两比较关系。

同艺术家活动 run 的部分唯一索引包含暂停状态。任务数据库策略要求 ARTWORK_DEDUP_SCAN 使用 BACKGROUND_WRITER、SYSTEM/900，领域命令使用操作者、幂等键和版本 CAS；普通重试不能改变稳定业务范围。最终分组复用创作者协调锁，并按作品 ID 锁定待发布 COMPLETE 作品，随后验证源和成员证据，持有至同事务任务完成提交。

readerToken 是跨暂停、失败、租约回收和进程重启保留的操作状态，不是可随缓存清除的字段。根绑定保存逻辑根、物理身份与有效归档映射；离线 reader 恢复只能在全局停写、原 token/版本/摘要一致时释放遗留占用，不能授权新根、修改文件或清除写入声明。具体协议见[第二阶段契约](../../../docs/design/artwork-deduplication/phase-2-contracts.md)，检查结果见[阶段记录](../../../docs/records/artwork-deduplication-phase-2-2026-10-23.md)。

F03 局部核验日期：2026-10-27。`20261027000200_artwork_dedup_visual_batches` 新增 `ArtworkDedupVisualPosting` 与 `ArtworkDedupVisualCandidate`，只通过 run 外键级联，不依赖活跃 Image 或历史 run 继续存在。posting 的重复次数约束为 1–4，候选作品 ID 必须严格左小右大；工作数据在 run 的执行／控制围栏下写入。可空 `visualCheckpoint` 保存分段游标，item 的 `visualReuseSignature` 保存本次物化的兼容复用资格；旧 run 不回填，新字段保持空值。领域重试只清本 run 的工作表、检查点及复用资格，保留长期文件／视觉指纹缓存；正常历史清理级联工作表，不涉及独立删除证据。扫描 v5 数据库任务策略及升级边界见[去重运维](../../../docs/operations/runbooks/artwork-deduplication.md)，完整分段与失败语义见[F03 契约](../../../docs/design/artwork-deduplication/visual-batches-f03-contract.md)。

局部核验日期：2026-10-28。`20261028000100_artwork_dedup_visual_rounds` 为检测 run 增加 `visualComparisonRound`、`visualRoundStartComparisons` 和 `visualBudgetWaiting`，默认 `0/0/false` 保留旧任务。正轮次要求累计实际比较加关系复用减去轮次起点处于本轮 20 万次之内，起点与轮次严格对应；SQL 使用 BIGINT 运算避免中间乘加溢出。等待标记只允许在 VISUAL/PENDING 且本轮满额的活动状态存在，因此仍在等待的任务不能被同步触发器误标为 COMPLETED。失败或取消收口才清除该标记。继续授权与原命令回执、版本检查和资源／任务／run 锁在同一事务中提交，重放不能重复加额；扫描任务策略允许 v6，维护版本不变。字段为加法迁移，不扫描媒体，不重置旧计数。详细边界见[第七批契约](../../../docs/design/artwork-deduplication/visual-batches-f03-contract.md)及[升级手册](../../../docs/operations/runbooks/artwork-deduplication.md)。

## Image 的 WebP 动画时长关系

`20260924120000_add_image_animation_duration_metadata` 新增 `ImageAnimationMetadata`，`imageId` 是 Image 的一对一主键和外键，`ON DELETE CASCADE`。这是加法迁移，不回填历史 Image；缺少关系行且已被确认动画（webpAnimationStatus=2）的 WebP 才进入时长候选。`durationMs` 和源文件 size/mtime/ctime/device/inode 使用 BIGINT；前端仅在 `READY`、当前时长策略、源路径匹配且 duration 能安全转成 number 时得到时长。`status,nextRetryAt,imageId` 索引用于有界候选和失败重试，不扫描原媒体来填列表。

`sourceRevision` 由已登记的文件变更与人工重试递增，配合 `writeInProgress`、前后 stat 和 Worker execution fence 拒绝迟到发布；`Image.updatedAt` 也会因排序和章节修改而变化，不用作文件版本。任务中无持久 PROBING：执行期间仍 PENDING，Worker 中断可恢复。故障时不要直接改回 READY；先确认原媒体与数据库检查点，再按[动图时长方案](../../../docs/architecture/animation-duration-probe.md)处理门禁和失败项。

## 扩展

- **pg_trgm**: 启用了 PostgreSQL 的 Trigram 扩展。
  - **用途**: 实现高效的模糊字符串匹配（类似 `LIKE '%text%'` 但性能更好，且支持索引）。
  - **来源**: `migrations/20250906135951_enable_pg_trgm_extension`

## 自动维护的计数与搜索

为了保证数据一致性并减少应用层逻辑复杂度，部分统计字段由数据库触发器自动维护。**应用层代码无需（也不应）手动更新这些字段。**

### 标签作品计数 (`Tag.artworkCount`)

**机制**: 当 `ArtworkTag` 表发生记录插入、删除或标签变更时，数据库自动更新对应 `Tag` 的 `artworkCount` 字段。

- **触发器**:
  - `artwork_tag_after_insert_trigger`: 关联增加时，计数 +1。
  - `artwork_tag_after_delete_trigger`: 关联移除时，计数 -1。
  - `artwork_tag_after_update_trigger`: 标签变更时，旧标签 -1，新标签 +1。
- **语句级函数 (`update_tag_artwork_count`)**:
  - 使用 transition table 对单条 SQL 影响的标签先聚合，再执行集合式增量更新。
  - 采用原子 `UPDATE` 保证并发正确性，并包含负数保护。
  - 正常成功操作不写 `TriggerLog`；触发器异常会中止关联写入，交由 PostgreSQL 和应用日志记录。

### 作品评分与喜欢计数 (`ArtworkLike.level`、`Artwork.likeCount`)

`20261022140000_artwork_rating_levels` 扩展原 `ArtworkLike` 表，新增 `SMALLINT NOT NULL DEFAULT 2` 的 `level` 列，CHECK 要求范围为 1–4。历史喜欢保持原记录 ID、账户与作品唯一约束、创建及更新时间，并自然成为喜欢档；未评分通过无记录表示，不创建默认行。表名沿用以减少迁移面，业务含义见[作品评分与喜欢](../../../docs/features/artwork-rating.md)。

- **计数阈值**：只有 `level >= 2` 的账户贡献一次，不能使用关联行总数充当喜欢计数。
- **触发器**：`artwork_like_count_trigger` 监听 INSERT、UPDATE、DELETE；`update_artwork_like_count()` 按变化前后的贡献计算增量，跨喜欢阈值或作品归属时更新对应计数，高档之间及同档写入不增减。父作品 ID 级联变更保留已随父行移动的计数，不重复累加。
- **校准**：迁移按阈值聚合校准，仅更新不一致的 `likeCount`，不重写评分历史时间戳。应用层不手工维护计数。
- **生命周期**：保留既有账户／作品删除级联关系；来源刷新、媒体替换和回收不清除评分。写入前先锁作品并核验活动状态，避免与删除竞争。

一般档写入后，旧程序按“存在关联即喜欢”的读写规则不再兼容。升级须停旧写入者并采用正式 migration；不能删列或清空一般档来回退，按[评分升级边界](../../../docs/features/artwork-rating.md#存储生命周期与升级)恢复匹配版本与数据。隔离旧库和触发器转换验证见[评分验证记录](../../../docs/records/features/artwork-rating.md)。

### 标签全文搜索 (`Tag.search_vector`)

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

### 作品图片计数 (`Artwork.imageCount`)

**机制**: 当 `Image` 表发生记录插入、删除或更新（修改归属作品）时，数据库自动更新对应 `Artwork` 的 `imageCount` 字段。

- **触发器**:
  - `artwork_image_count_trigger` (AFTER INSERT): 批量增加计数。
  - `artwork_image_count_delete_trigger` (AFTER DELETE): 批量减少计数。
  - `artwork_image_count_update_trigger` (AFTER UPDATE): 处理图片所属作品变更的情况（旧作品-1，新作品+1）。
- **优化**:
  - 采用 **语句级触发器 (FOR EACH STATEMENT)** 而非行级触发器，在批量操作时极大减少数据库 I/O 和锁竞争。
  - 逻辑封装在 `update_artwork_image_count()` 函数中。
- **初始化**: Migration 脚本中包含了全量校正 SQL。

## 手写索引与队列约束

- pg_trgm 的 Artwork 标题/描述表达式 GIN 与 Artist 名称 GIN 服务模糊搜索；查询表达式必须与迁移一致，不能假定普通单列索引等价。
- system_jobs_single_executing_per_lane_idx 是执行态部分唯一索引，限制每 lane 至多一个 RUNNING/PAUSING/CANCELLING。类型与 lane 的 CHECK 随正式迁移更新，精确列表以最新迁移和 job-contracts 为准；本文不复制任务清单。
- 计划日期唯一约束防止同一天重复物化，活动批次部分唯一索引防止重叠发现批次。租约、事件游标和 GC 索引服务领取与恢复，不替代领域发布检查。
- 20261011000000_background_task_retirement_contract 在停写审计后移除旧目标列及计划 time/timezone 等字段，availableAt 已为 NOT NULL；中央任务执行态必须有完整 workerId/leaseToken/leaseExpiresAt，非执行态须全空，SKIPPED 和计划字段保持成组约束。definitionVersion=0 仅允许终态历史；legacyDisplay 只作展示，不能重新执行。
- 原队列 progress/attempt 等 CHECK 的历史验证状态必须查目标库，不能因新增 contract 约束已 VALIDATE 就假设所有旧约束已验证。早期 NOT VALID 的背景见[迁移历史](../../../docs/records/architecture/database-migration-history.md)。
- 归档活动 URL/Provider 身份部分唯一约束、submission/bulk request hash 和来源查询指纹保障去重与幂等。相同幂等键不能接受不同内容；完整匹配仍比较规范化原值，不能只比较 hash。
- 20261003120000_index_archive_intake_url_matching 为提交/规范 URL 添加非唯一 Hash 索引，避免长 URL B-tree 项大小限制；查询仍由 PostgreSQL 复核完整字符串，不改变匹配优先级或时间边界。

## 创作者与来源关系

有效创作者来自 effective_artwork_creators 视图：关系至少有 present=true 且 excludedAt 为空的依据。seed_legacy_artwork_creator 仅在 Artwork INSERT 时为旧 artistId 建立 LEGACY 初始依据，UPDATE 不重新认领。旧路径身份不能由多对多展示关系反写。外部身份唯一性、人工关系与来源证据详见[创作者关系](../../../docs/features/creator-relations.md)。

艺术家外部引用及系列多对多已取代 Artist.userId、Artwork.seriesId 和 Series.source/externalId；这些旧列已由正式 contract 迁移删除。历史兼容镜像不是当前写入目标，恢复与历史 direct-only 决定见[旧身份退役](../../../docs/features/legacy-identity-retirement.md)。

来源删除按来源锁再 Provider/GID 锁的固定顺序进行，事务复核相关非终态任务。来源的扫描/目录级联删除不会反向删除收件、下载、作品或媒体；全局忽略采用 SetNull 保留身份。触发器与外键不能代替 Worker 的文件维护。

## 维护与恢复约束

高风险扫描/导入/迁移/替换保存冻结输入和逐项检查点，不能把整个输入目录或恢复进度仅留在内存。大量输入使用领域表，不塞入单个 payload。数据库事务、文件发布和执行 fence 的配合见[后台机制](../../../docs/architecture/background-jobs.md)及[业务链路](../../../docs/architecture/background-job-business-flows.md)。

TriggerLog 保存维护摘要，普通成功 ArtworkTag 写入不逐条记录；触发器失败应中止关联写入。人工工具包括 check_tag_count_consistency()（只读核对）、fix_tag_count_inconsistencies()（集合修复并记维护摘要）、cleanup_trigger_logs()（清理历史）。修复不是部署例行步骤，必须先建立恢复依据；保留策略见相应维护任务。

数据库 dump 必须包含扩展、视图、函数、触发器和手写索引，不能只导出 Prisma 可表达的表。修改计数触发器或直接修复数据后，统计快速计数必须重新核验，见[统计查询](../../../docs/architecture/statistics-query-performance.md)。

迁移只能通过 generate/deploy 流程执行，不能用 db:push 代替迁移历史。guard 只验证执行时状态，不替代停止旧写入者；文件系统和数据库恢复使用同一检查点。操作依据见[部署](../../../docs/operations/deployment.md)与[备份恢复](../../../docs/operations/backup-and-recovery.md)。

## 归档阶段与执行代

`ArchiveImport.id` 是稳定业务身份，`systemJobId` 仅为当前阶段指针。`phase` 区分旧兼容、下载、发布；`origin` 仅冻结新入队的真实来源，旧未知值保持 NULL。`ArchiveImportExecution` 保存阶段/重试对应的全部 SystemJob；前驱由 SystemJob.parentJobId 关联。任务 type/lane 数据库触发器禁止修改。

`ArchiveStagingGeneration.token` 为执行 token，记录隔离目录、封存摘要、seal/drain/cleanup 时间。项目 checkpoint 的 `stagedGenerationPath` 支持接管复制中断后仍找到各完整文件；封存前全部复制到当前代。`drainedAt` 只由已等候全部 I/O 的合法执行提交，不由过期租约推断。发布依赖当前 token 与清单摘要，清理意图阻断领取及交接。详细生命周期和恢复见[归档生命周期](../../../docs/features/archive-lifecycle.md)。
