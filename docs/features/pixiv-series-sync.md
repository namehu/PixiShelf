---
status: current
scope: Pixiv 系列外部身份、作品成员关系、核对任务与管理端行为
last-verified: 2026-08-27
sources:
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-job-executors/src/pixiv-artwork/series-sync.ts
  - packages/pixishelf-job-executors/src/pixiv-series/
  - packages/pixishelf/services/pixiv-series-reconciliation-service.ts
  - packages/pixishelf/services/series-service.ts
---

# Pixiv 系列来源身份与核对

PixiShelf 使用 `SeriesExternalRef` 保存系列的 Provider 身份。Pixiv 系列以
`providerKey=pixiv + externalId=<series-id>` 唯一标识，不按标题匹配或合并；因此同名但 Pixiv ID 不同的系列保持独立，
本地手工系列也可以与 Pixiv 系列同时存在。

`Series.source/externalId` 与 `Artwork.seriesId` 只保留为一个发布周期的回滚兼容字段。新的管理端写入、作品详情和系列导航
以 `SeriesArtwork` 为事实源，一个作品可以同时属于多个系列。

## 成员与字段所有权

`SeriesArtwork.provenance` 区分三类成员关系：

- `SOURCE`：由一个明确的 Pixiv `ArtworkExternalRef` 拥有；来源变化时只允许该引用更新或删除自己的关系。
- `MANUAL`：管理员在系列详情中添加；Pixiv 核对不会删除或认领。
- `LEGACY`：迁移时无法证明来源；Pixiv 核对不会删除或认领。

来源关系同时保存 Pixiv 顺序 `sourceOrder` 和当前展示顺序 `sortOrder`。管理员手工排序会设置
`orderOverridden`；普通核对只刷新来源观察值，刷新模式才尝试恢复 Pixiv 顺序。任务抓取后发生的新人工编辑优先，冲突项
记为部分成功。

管理员移除 `SOURCE` 成员时不会删除作品，而是写入 `excludedAt` 本地排除。普通核对和刷新都不会静默恢复该成员；在系列
详情中显式重新添加才能恢复。`MANUAL` 与 `LEGACY` 成员的移除仍直接删除关系。

Pixiv 标题默认只在 `titleOverridden=false` 时更新。管理端只有标题实际变化时才建立人工覆盖；“刷新已有系列资料”会尝试
采用最新 Pixiv 标题，但仍保护任务期间的新编辑。描述和封面本期不从 Pixiv 获取。

## 系列状态解析

作品资料中的系列字段被规范化为三态：

- `PRESENT`：具有合法正整数系列 ID，可创建或更新来源系列与成员关系；
- `NONE`：Pixiv 明确返回 `null`，只移除当前作品来源引用拥有的旧 `SOURCE` 关系；
- `UNKNOWN`：字段缺失、类型异常或 schema 不完整，成员关系零写入并记为部分成功。

作品在线同步会在同一发布事务中调用系列领域逻辑。独立的 `PIXIV_SERIES_RECONCILIATION` 用于消费现有快照和完成历史
回填，不创建本地不存在的作品，也不下载 Pixiv 原图。

## 连续核对任务

`DISCOVER` 以 200 条作为数据库分页大小；未显式选择时会把全部候选连续物化为持久子任务，200 不是整批上限。

- 普通模式：处理 `seriesSyncStatus` 为空的全部唯一数字 Pixiv 作品身份。
- 刷新模式：处理全部符合条件的 Pixiv 作品，按最久未检查优先。
- 显式 API 选择：最多 200 个作品。
- 子任务：每个作品一项，运行在并发为 1 的 `BACKGROUND_WRITER` lane。

子任务优先读取数据库当前 `onlineSnapshotHash/onlineSnapshotPath` 指向的不可变 metadata 文件。读取时校验固定作品目录、
64 位哈希文件名、根目录边界、符号链接、普通文件、大小和作品身份；没有有效快照时才使用已有 Pixiv 作品客户端查询并保存
新快照。路径或快照内容不能由浏览器直接指定。

管理端展示待核对作品数、成功、部分成功、无系列和失败数量，以及发现进度和子任务终态进度。整批取消先停止父任务继续
发现，再批量取消尚未完成的子任务；已经发布的关系不回滚。任务中心可以重试失败子任务。

## 管理端与读取行为

系列列表支持本地/Pixiv 来源和 Pixiv 核对状态筛选，并展示正式 Pixiv ID。系列详情展示每个成员是 Pixiv 来源、手工添加
还是历史关系，以及来源关系是否采用了本地排序。

作品详情读取全部未排除的 `SeriesArtwork`，为每个系列分别计算上一项和下一项。旧 `Artwork.seriesId` 不再决定浏览页只能
显示一个系列。

## 迁移与发布

上线前运行 `series-source-identity-audit.sql`。Migration 只把 `source=LOCAL` 的既有关系认定为 `MANUAL`；旧 Pixiv 系列
只有在旧记录明确声明 `source=PIXIV`、数字 external ID 全局唯一、每个成员作品都具有唯一数字 Pixiv 引用，且成员作品
不存在第二条系列关系时，才自动建立 `SeriesExternalRef` 并将整个系列的既有关系认领为 `SOURCE`。生产不要求
`ArtworkRawMetadata`：在线作品响应保存在 `pixiv_data` 磁盘快照，数据库旧表可能为空。重复系列 ID、多 Pixiv 引用、
多系列成员和无成员系列仍保守保留为 `LEGACY`，等待管理员核对。

发布顺序为：一致性备份 → `prisma migrate deploy` → `series-external-ref-verification.sql` → Worker → READY/capability →
App。先少量核对并验证多系列导航、来源关系和本地排除，再启动全部未检查作品。
