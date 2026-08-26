---
status: current
scope: 已有 Pixiv 作品的在线元数据同步、来源字段所有权、磁盘快照与持久任务
last-verified: 2026-08-26
sources:
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf/server/routers/artwork.ts
  - packages/pixishelf/services/pixiv-artwork-enrichment-service.ts
  - packages/pixishelf-job-executors/src/pixiv-artwork/
  - packages/pixishelf-job-executors/src/scan/pixiv-publisher.ts
---

# Pixiv 作品在线同步

作品在线同步只维护已经存在于 PixiShelf、且恰好具有一个有效数字 Pixiv 外部引用的 Artwork。它不会从远端创建作品，也不会下载 Pixiv 原图。管理员从作品管理页手工启动连续同步、选择不超过 200 项同步、取消整批任务，或重试单个失败项。

## 候选与任务模型

`PIXIV_ARTWORK_ENRICHMENT` 使用持久父子任务：

- `DISCOVER` 先统计候选，再按稳定游标每页发现 200 个，直到耗尽；200 是数据库分页大小，不是全量批次上限。
- 普通模式处理全部从未检查的有效 Pixiv 作品；刷新模式处理全部有效 Pixiv 作品，并优先发现最久未检查的引用。
- 显式选择最多 200 项。每项物化一个独立 `ARTWORK` 子任务，父任务重试会幂等复用已有子任务。
- 子任务在 `BACKGROUND_WRITER` lane 中以低优先级逐个执行；关闭或刷新管理页不影响运行。
- 整批取消先阻止父任务继续发现，再锁定并取消所有未完成子任务；已经发布的领域字段和磁盘快照不会回滚。

App 只有在新鲜 READY Worker 明确报告 `PIXIV_ARTWORK_ENRICHMENT@v1 / BACKGROUND_WRITER` capability 时才允许入队。页面展示发现进度、已物化数量、子任务终态统计以及最近批次；单项重试不会替换批次展示。

## 远端请求与身份边界

Worker 不使用 Cookie 或登录会话，只请求 `https://www.pixiv.net/ajax/illust/<id>`。请求限制目标主机和每次重定向，超时为 12 秒，响应上限为 1 MB。429、5xx 和网络故障按任务重试策略处理；404 记为“无数据”；非法重定向、异常 JSON、结构不完整或响应作品 ID 与当前外部引用不一致时不发布领域数据。

同步开始和最终发布前都重新确认当前 Artwork 仍只有同一个 Pixiv 引用。引用新增、删除或改变时，旧响应不会写回。

## 磁盘快照

成功响应原子保存到：

```text
pixiv_data/artworks/<pixiv-id>/metadata/<sha256>.json
```

文件包含受 1 MB 上限约束的原始响应、规范化数据和首次抓取时间。SHA-256 由稳定内容计算；相同内容复用已有文件，内容变化创建新的不可变版本。数据库只在 `ArtworkExternalRef` 保存最近哈希、相对路径、状态、错误和任务时间。历史版本不自动清理。

`artworks/.../metadata/*.json` 是 Worker 的内部恢复证据，不属于媒体展示接口；`/api/pixiv-data` 只允许既有作者图片和标签封面类型，不暴露作品 JSON。

## 字段所有权与文本保护

同步会更新当前 Pixiv 引用拥有的统计、来源 URL、尺寸、发布日期、限制级别、AI、作品类型和 sanity 字段，但不修改 Artist、Series、媒体、媒体顺序、`Artwork.likeCount`、本地 metadata 或 inventory。系列信息只留在磁盘快照中。

标题和描述遵守显式人工覆盖：

- 默认模式只更新未被人工 override 的字段。
- “采用最新 Pixiv 标题和描述”会用远端文本更新字段，并把对应 override 恢复为来源管理。
- App 编辑只有在文本值实际变化时才建立人工 override；保存未改动表单不会误标。
- Worker 在请求前记录已观察值，最终事务中再次比较。期间发生的新人工编辑优先，冲突字段不覆盖，任务记为部分成功。

migration 只修正有精确证据的历史误标：作品必须只有一个 Pixiv 引用，并且当前标题或描述与最近数据库 Pixiv 来源快照中的对应值完全一致。没有快照键、值不一致或身份不唯一的数据保持不变。

## 标签精确同步

远端响应必须包含完整标签数组，才允许修改标签关系。发布时：

- 添加远端新声明的标签，并建立由当前 Pixiv 引用拥有的 `SOURCE` 关系；
- 删除远端已不再声明、且由当前 Pixiv 引用拥有的 `SOURCE` 关系；
- 保留 `MANUAL`、`DERIVED`、其他来源引用拥有的关系，以及没有被确认归属的 `LEGACY` 关系。

因此同步不是“清空作品全部标签”，也不是只增不减；它只精确替换当前 Pixiv 引用能够证明拥有的集合。响应不完整或身份校验失败时标签零写入。

## 状态与发布

引用状态统一为未检查、成功、部分成功、无数据和失败。成功或无数据会记录检查时间；失败保留错误码和可供单项重试的最近任务。磁盘已经发布但数据库事务失败时，重试会复用同内容文件并重新完成数据库发布。

生产发布前必须创建 PostgreSQL 与 `PIXISHELF_PUBLIC_DATA_PATH` 的一致性备份，部署 migration，确认 Worker READY/capability 后再开放 App。先选择少量作品验证状态、字段所有权、标签差异和磁盘快照，再启动全部未检查作品；“采用最新文本”也应先小批试跑。
