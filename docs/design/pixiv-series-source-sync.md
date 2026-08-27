---
status: historical
scope: 系列来源身份、系列成员关系收敛，以及基于 Pixiv 作品资料的系列同步
last-verified: 2026-08-27
sources:
  - docs/product/product-baseline.md
  - docs/features/pixiv-artwork-online-sync.md
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf/services/series-service.ts
  - packages/pixishelf-job-executors/src/pixiv-artwork/
---

# Pixiv 系列来源身份与同步设计（实施记录）

本文保留 2026-08-27 实施前的设计边界和取舍，不作为当前接口说明。已实现行为以
[Pixiv 系列来源与核对](../features/pixiv-series-sync.md)、Prisma Schema 和任务契约为准。

## 问题与现状

当前 `Series` 具有 `source` 与 `externalId`，但没有正式的多来源身份模型、同步状态或来源字段所有权。现有 App
只能手工创建、编辑、删除系列，以及手工添加、移除和排序作品；扫描与在线同步均不会正式创建或更新系列。

系列成员关系同时保存在两处：

- `SeriesArtwork` 表达一个作品可加入多个有序系列；
- `Artwork.seriesId` 只表达一个系列，并由当前手工服务作为反范式字段同步写入。

两者没有数据库约束保证一致。作品详情也只读取 `Artwork.seriesId`，因此多对多模型在数据库、管理页和浏览页之间
没有形成一致契约。

Pixiv 作品在线响应与 downloader JSON 已包含系列 ID、标题和作品在系列中的顺序，但当前实现只把在线
`seriesNavData` 保存在磁盘 metadata 快照，明确禁止写入 `Series`。

## 目标与非目标

### 目标

1. 用正式的 `SeriesExternalRef` 表达 Pixiv 等 Provider 的系列身份，不再让 `Series.source/externalId` 承担长期身份语义。
2. 让 `SeriesArtwork` 成为系列成员关系和排序的唯一事实源，并保留一个作品属于多个系列的能力。
3. 从已经验证身份的 Pixiv 作品资料创建或更新 Pixiv 系列，并只关联本地已有 Artwork。
4. 区分来源关系、人工关系和无法证明归属的历史关系；来源刷新不能删除人工关系。
5. 保护人工标题、描述、成员关系和排序，并支持管理员显式刷新来源管理字段。
6. 提供可预检、可取消、可重试、可恢复的全量系列认领任务，以及清楚的管理页面状态。

### 非目标

- 不创建数据库中不存在的远端 Artwork，不下载 Pixiv 原图。
- 第一版不请求独立的 Pixiv 系列详情接口；只消费作品接口或既有可信 metadata 快照中明确声明的系列信息。
- 不自动把本地同名系列与 Pixiv 系列合并。
- 不让一个来源刷新删除 `MANUAL`、其他 Provider 或未确认的 `LEGACY` 关系。
- 不在同一次 migration 物理删除 `Artwork.seriesId`、`Series.source` 或 `Series.externalId`。
- 不同时重命名 `Image` 表或实施媒体类型结构化技术债。

## 已确定的领域语义

### 真正的多对多

`SeriesArtwork` 是唯一关系事实源。一个 Artwork 可以同时属于：

- 一个 Pixiv 来源系列；
- 一个或多个管理员创建的本地整理系列；
- 未来其他 Provider 的来源系列。

浏览页不再从 `Artwork.seriesId` 推导唯一系列，而是读取全部有效 `SeriesArtwork`。每个系列独立提供当前位置、上一篇和
下一篇导航。`Artwork.seriesId` 在兼容期只由旧代码读取，不再作为新写入的权威依据。

### 来源身份

新增 `SeriesExternalRef`，至少保存：

- `seriesId`、`providerKey`、`externalId` 和 canonical URL；
- 来源标题；
- 最近检查、成功、错误和任务状态；
- 最近观察到的本地成员数、远端声明数和缺失成员数。

Pixiv 身份使用 `providerKey=pixiv`。同一 Provider 外部 ID 只能归属一个本地 Series；同一本地 Series 对同一
Provider 最多有一个身份。手工系列不需要伪造本地 ExternalRef。

旧 `Series.source/externalId` 暂留一个发布周期用于回滚。新代码不再创建或依赖它们。

### 字段所有权

`Series` 增加标题和描述的人工覆盖标记。封面继续使用现有本地封面或系列首个可见作品的派生封面，第一版不下载
Pixiv 远端系列封面。

- 默认同步只填充空字段，并更新仍由来源管理的字段；人工覆盖值保持不变。
- “刷新已有资料”使用最新来源标题，并恢复该字段的来源管理。
- App 编辑只有在值实际变化时才建立人工覆盖。
- Worker 请求或读取快照后，最终事务再次比较观察值；期间发生的新人工编辑优先，冲突记为部分成功。

### 成员与排序所有权

`SeriesArtwork` 增加 `SOURCE`、`MANUAL`、`LEGACY` provenance、来源 ArtworkExternalRef，以及远端顺序和本地有效顺序。

- 管理页手工添加的关系为 `MANUAL`。
- Pixiv 作品资料新建的关系为 `SOURCE`，由声明该关系的 Pixiv ArtworkExternalRef 拥有。
- 当前存量本地系列关系迁移为 `MANUAL`；只有具备精确 Pixiv 身份和系列 ID 证据的历史关系才能迁移为 `SOURCE`。
- 无法证明来源的异常历史关系保留为 `LEGACY`，不自动删除。
- 来源明确改为其他系列或明确不再属于系列时，只删除同一 ArtworkExternalRef 拥有的旧 `SOURCE` 关系。
- 如果远端声明的同一关系已经是 `MANUAL` 或未确认的 `LEGACY`，保留现有关系，不夺取所有权。
- 管理员调整来源关系的本地顺序时建立顺序覆盖；默认同步只更新远端顺序，刷新模式才恢复远端有效顺序。

只有响应明确包含合法系列对象或明确的 `null`，才允许修改成员关系。字段缺失、schema 异常或身份不符时系列零写入，
不得把“不知道”解释为“已退出系列”。

## 数据迁移与审计

Expand migration 执行以下动作：

1. 创建 `SeriesExternalRef` 和系列同步状态字段。
2. 为 `Series` 增加标题、描述覆盖标记。
3. 为 `SeriesArtwork` 增加 provenance、来源引用、远端顺序和顺序覆盖字段。
4. 将当前 `source=LOCAL` 的既有关系迁移为 `MANUAL`；这是现有 App 唯一正式写入路径。
5. 对 `source=PIXIV` 且 external ID 为正整数的 Series，仅在成员 Artwork 具有唯一 Pixiv 引用，并且可信
   metadata 明确声明相同 series ID 时，创建 Pixiv ExternalRef 并认领对应 `SOURCE` 关系。
6. 其他异常 `PIXIV`、重复 ID、关系冲突和无法证明来源的记录进入审计报告，不猜测合并。

上线前诊断必须统计：

- Series 总数及 `source/externalId` 分布；
- 重复 Pixiv external ID；
- 单作品多系列数量；
- `Artwork.seriesId` 与 `SeriesArtwork` 的 direct-only、join-only 和冲突关系；
- 可自动认领、需保留为手工、需保留为 LEGACY 和阻塞 migration 的数量。

Contract migration 只能在新代码稳定运行至少一个发布周期、生产审计确认没有旧消费者后，独立删除
`Artwork.seriesId`、`Series.source`、`Series.externalId` 和 `SeriesType`。

## Worker 与同步流程

新增 `PIXIV_SERIES_RECONCILIATION`，继续运行在 `BACKGROUND_WRITER` lane，并发保持为 1。

### 发现

- `DISCOVER` 统计具有唯一数字 Pixiv ArtworkExternalRef 的本地作品，并按 Artwork ID 稳定分页，每页 200 个。
- 普通模式处理尚未进行系列核对的作品；刷新模式处理全部符合条件的作品，最久未检查优先。
- 手工选择最多 200 项；未选择时连续处理全部候选。
- 每个作品形成独立、幂等、可重试的子任务，关闭页面不影响执行。

### 资料来源优先级

子任务优先读取 `ArtworkExternalRef.onlineSnapshotPath` 指向的已验证磁盘快照，不重新请求 Pixiv；没有有效快照时才按
现有作品在线同步客户端请求作品接口，并复用相同的主机、重定向、超时、响应大小和身份校验边界。

读取磁盘文件时必须校验固定作品目录、64 位哈希文件名、普通文件、符号链接、文件大小、快照作品 ID 和数据库当前
身份。损坏或身份不符的快照不能写入系列。

### 发布

最终数据库事务锁定当前 Artwork、ArtworkExternalRef、目标 SeriesExternalRef 和相关 SeriesArtwork：

1. 再次确认唯一 Pixiv 作品身份未变化。
2. 解析明确的系列状态：`PRESENT`、`NONE` 或 `UNKNOWN`。
3. 对 `PRESENT` 按 `(pixiv, seriesId)` 查找或创建 SeriesExternalRef；不按标题匹配。
4. 根据字段与关系所有权更新 Series 和 SeriesArtwork。
5. 对 `NONE` 只移除当前 ArtworkExternalRef 拥有的旧 `SOURCE` 关系。
6. 记录成功、部分成功、无系列或失败状态，并提供成员变化计数。

作品在线同步发布器同时接入相同的领域函数，使以后每次作品同步都能持续维护系列；独立 reconciliation 任务负责
消费已经存在的快照和完成首次全量回填，不要求所有作品重新访问 Pixiv。

## App 行为

系列管理页增加：

- 本地、Pixiv 和混合来源标识；
- Pixiv 系列同步状态筛选；
- 连续认领全部、连续刷新全部和最多 200 项手工选择；
- 发现与执行进度、整批取消和失败项重试；
- 远端顺序、本地有效顺序、人工覆盖和缺失本地作品数量。

系列详情页对来源关系和人工关系使用不同的中性标识。手工删除来源关系等同建立本地排除，不应在下一次默认同步中
静默恢复；恢复来源关系必须是显式操作。手工重排只建立顺序覆盖，不改写远端观察值。

作品详情读取全部系列成员关系。一个作品属于多个系列时，为每个系列分别展示紧凑导航，不再依赖单一
`Artwork.seriesId`。

## 测试与发布门禁

- Migration：空库完整部署、LOCAL 关系回填、精确 Pixiv 认领、重复 ID、direct/join 冲突和重复执行安全。
- 解析：合法系列、明确 null、字段缺失、异常 ID、异常顺序、schema 变化和作品身份不符。
- 领域：创建系列、同名不同 ID、标题保护、显式刷新、SOURCE 精确移除、MANUAL/LEGACY 零删除和并发编辑。
- Worker：201/5001 候选分页、快照复用、无快照远端回退、重试幂等、整批取消、重启恢复和 capability 门禁。
- UI：来源/状态筛选、多系列导航、顺序覆盖、批次恢复、重试和空状态。
- 执行 migration 链、相关 PostgreSQL 集成测试、Worker typecheck/test/build、Next lint/typecheck/test/build、路径大小写和
  `git diff --check`。

发布顺序：一致性备份 → migration → Worker → READY/capability → App。生产先运行只读审计，再选择少量作品认领，
核对系列数量、来源身份、成员 provenance 和多系列导航后，才启动全部未检查作品。旧字段的物理删除不进入本次发布。
