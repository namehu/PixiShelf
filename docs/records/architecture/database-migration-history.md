---
status: historical
scope: 数据库早期队列切换守卫、兼容约束与迁移对照记录
---

# 数据库迁移历史说明

以下按原切换时点保留。availableAt 可空、旧目标列与计划字段等兼容设计已被后续 contract migration 替代；现行约束见[数据库补充](../../../packages/pixishelf-db/prisma/database-design.md)。完整迁移历史以 migrations 和目标库 \_prisma_migrations 为准。

### 4.1 后台任务切换守卫与手写约束

`20260814091000_add_background_task_queue_schema` 使用显式事务，事务内第一条业务语句是只读 `DO` 守卫。它在任何 DDL、回填或索引创建前检查旧任务、归档导入、扫描、批量替换、视频探测/封面/章节/关键帧和归档生命周期共 12 类活动状态。关键帧 `STAGING` 集合在任务引用为空、关联任务缺失或关联任务非终态时也会阻断。发现阻断项时 migration 只报错并退出，不会替业务数据“收口”。该守卫是停机流程的第二道防线，不是并发写屏障；执行 migration 前仍必须按 Runbook 停止全部旧写入者。

该 migration 不更新或删除 Artwork、Image、媒体、归档、扫描、替换等领域记录；只回填旧 `system_jobs` 和 `scheduled_tasks` 的队列兼容字段。旧任务被标记为 `definitionVersion=0`、`triggerSource=LEGACY`，不补造事件或 GC 删除意图。

以下数据库约束由 migration 手写，因为 Prisma schema 不能表达 `CHECK`：

- `system_jobs.progress` 必须为 0–100，`attempt >= 0`、`maxAttempts >= 1`、`definitionVersion >= 0`。
- `system_job_events.progress` 为空或为 0–100。
- `derived_media_gc_entries.attempt >= 0` 且 `maxAttempts >= 1`。

`system_jobs` 是历史表，切换审计并不读取每条旧记录的 progress/attempt。它的四个 CHECK 首次以 `NOT VALID` 创建：创建时不扫描未触碰的历史行，但会立即约束新插入，也会校验之后被更新的旧行（即使只更新无关字段）。这样可避免未知旧历史值在创建约束时扩大停机风险。部署后的兼容审计应先报告并修复异常旧值，再在独立 migration 中执行 `VALIDATE CONSTRAINT`。新建的事件和 GC 表为空，因此其 CHECK 在创建时直接验证。

本兼容阶段为 `system_jobs.availableAt` 回填值并增加 `CURRENT_TIMESTAMP` 默认值，但暂不设置 `NOT NULL`：旧关键帧入口仍会显式写 `NULL`，并把它解释为“立即可领取”。严格租约全有/全空、`SKIPPED` 字段一致性、计划字段成对约束及 `availableAt NOT NULL`，统一延后到旧执行入口完全迁走后的清理 migration，避免破坏停机升级后的回滚能力。

`20260904200000_add_system_job_progress_data` 以 additive 方式为 `system_jobs` 增加可空 JSONB `progressData`；既有任务不回填并保持 `NULL`。Worker 在持有 execution fence 的同一事务中更新百分比、阶段、结构化进度并插入 `system_job_events`，避免 SSE 读取到事件与任务快照不一致。事件保留任务使用 `(type, level, createdAt, id)` 索引分页选择：普通 `job.progress` 保留 7 天，阶段、告警、控制和终态事件保留 90 天，每批最多删除 5,000 条。

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
| `20260827090000` | 增加系列多 Provider 外部身份、成员来源、远端排序、人工覆盖与排除状态；保留旧来源和单系列字段作为兼容镜像                                        |
| `20260902120000` | 增加 E-Hentai 上传者来源、人工扫描运行与候选结果，扩展 SEARCH 请求类，并允许上传者扫描进入 `ARCHIVE_RESOLVE` lane                               |
| `20260904120000` | 增加 E-Hentai 上传者稳定 UID、UID 覆盖复核状态与扫描运行查询身份快照；既有 UID 来源原地回填且不重置扫描水位                                     |
| `20260930120000` | 联合检查艺术家、系列和旧目录迁移现场已收口后，删除 `Artist.userId` 与旧复合唯一索引                                                             |
| `20260930121000` | 再次检查系列身份、direct pointer 和旧目录迁移现场后，删除 `Artwork.seriesId`、`Series.source/externalId` 及旧约束                               |
