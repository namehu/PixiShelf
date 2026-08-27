---
status: current
scope: 已有 Pixiv 作品的在线元数据同步、来源字段所有权、磁盘快照与持久任务
last-verified: 2026-08-27
sources:
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf/server/routers/artwork.ts
  - packages/pixishelf/services/pixiv-artwork-enrichment-service.ts
  - packages/pixishelf-job-executors/src/pixiv-artwork/
  - packages/pixishelf-job-executors/src/maintenance/pixiv-ai-derived-tag-sync.ts
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

文件包含受 1 MB 上限约束的原始响应、规范化数据和首次抓取时间。SHA-256 只使用带版本号、显式枚举的稳定核心作品字段；完整原始响应以及浏览量、点赞数、收藏数等实时统计不参与哈希，快照仍保留首次命中该核心内容版本时的完整响应。`bookmarkCount` 继续按现有规则写回，`Artwork.likeCount` 等既有字段边界不变；实时统计不会单独制造快照版本。相同核心内容复用已有文件，核心内容变化创建新的不可变版本。数据库只在 `ArtworkExternalRef` 保存最近哈希、相对路径、状态、错误和任务时间。历史版本不自动清理。

`artworks/.../metadata/*.json` 是 Worker 的内部恢复证据，不属于媒体展示接口；`/api/pixiv-data` 只允许既有作者图片和标签封面类型，不暴露作品 JSON。

## 同步报告与可视化核对

成功或部分成功的作品子任务还会原子写入一份按任务 ID 命名的报告：

```text
pixiv_data/artworks/<pixiv-id>/sync-reports/<job-id>.json
```

报告不复制远端响应，而是记录最终事务中实际发生的字段前后值、当前 Pixiv ref 拥有的 `SOURCE` 标签增删、人工编辑保护项，以及同步前后 metadata 快照引用。超长文本只保留预览、原始长度和 SHA-256；完整新值仍可从对应 metadata 快照核对。报告区分数据库有更新、仅稳定快照变化、完全无变化和部分更新。文件写入失败会使领域事务回滚并进入既有重试流程，因此不会把缺少报告的任务标为同步完成。

作品管理页的 Pixiv 同步列可以打开报告抽屉，分页浏览该作品的完整有效报告历史，查看字段和标签差异，并按需懒加载同步前后的 `raw` 与 `normalized` JSON。App 不开放任意文件路径，也不改变 `/api/pixiv-data` 的图片边界；管理查询会重新确认唯一 Pixiv 身份、已完成任务、报告身份、固定目录、哈希文件名、文件大小和安全路径。报告功能上线前的旧任务显示为“暂无详细同步报告”，不会误判为内容无变化。

## 字段所有权与文本保护

同步会更新当前 Pixiv 引用拥有的统计、来源 URL、尺寸、发布日期、限制级别、AI、作品类型和 sanity 字段，但不修改 Artist、Series、媒体、媒体顺序、`Artwork.likeCount`、本地 metadata 或 inventory。系列信息只留在磁盘快照中。

Pixiv 的 AI 判定以 `aiType` 为准：`2` 表示 AI 生成，`1` 表示非 AI；只有旧数据缺少 `aiType` 时才回退到历史 `isAiGenerated`。本地 downloader metadata 中的 `AI生成` 是对 `aiType=2` 的重复表达，不属于 Pixiv API 的真实标签集合。

标题和描述遵守显式人工覆盖：

- 默认补全只更新未被人工 override 的字段。
- 开启“刷新已有资料”后，会刷新 Pixiv 来源负责的全部资料，包括用远端文本更新标题和描述，并把对应 override 恢复为来源管理。
- App 编辑只有在文本值实际变化时才建立人工 override；保存未改动表单不会误标。
- Worker 在请求前记录已观察值，最终事务中再次比较。期间发生的新人工编辑优先，冲突字段不覆盖，任务记为部分成功。

migration 只修正有精确证据的历史误标：作品必须只有一个 Pixiv 引用，并且当前标题或描述与最近数据库 Pixiv 来源快照中的对应值完全一致。没有快照键、值不一致或身份不唯一的数据保持不变。

## 标签精确同步

远端响应必须包含完整标签数组，才允许修改标签关系。发布时：

- 添加远端新声明的标签，并建立由当前 Pixiv 引用拥有的 `SOURCE` 关系；
- 删除远端已不再声明、且由当前 Pixiv 引用拥有的 `SOURCE` 关系；
- 保留 `MANUAL`、`DERIVED`、其他来源引用拥有的关系，以及没有被确认归属的 `LEGACY` 关系。

因此同步不是“清空作品全部标签”，也不是只增不减；它只精确替换当前 Pixiv 引用能够证明拥有的集合。响应不完整或身份校验失败时标签零写入。

`AI生成` 使用独立的 `DERIVED` 关系和固定 `systemKey=pixiv:ai-generated`，由 `aiType=2` 维护。扫描导入会从 downloader 标签数组中剔除这项重复的 `SOURCE` 表达，再建立派生关系；在线同步不会因为 Pixiv API 的标签数组没有 `AI生成` 而把它记录为来源移除。如果未来 Pixiv API 确实把同名标签放进完整远端标签数组，则按普通 Pixiv `SOURCE` 标签处理。`MANUAL`、其他 Provider 的 `SOURCE` 关系始终受保护。

## 历史数据校准

后台任务页提供 `PIXIV_AI_DERIVED_TAG_SYNC` 的两阶段入口，处理已有大量作品时不需要一次性加载全库：

- “只读预检”按 Artwork ID 每批 500 条读取，仅统计会创建、转换、移除和受保护的关系，不写数据库；
- “执行回填”使用同样的稳定游标分批提交，把当前 Pixiv 引用拥有的 `SOURCE` 或 `LEGACY` 同名关系转换为 `DERIVED`，为缺失关系的 AI 作品补建派生标签，并删除明确非 AI 作品上过期的 `DERIVED` 关系；
- `MANUAL` 和其他来源拥有的 `SOURCE` 关系不会转换或删除；AI 状态未知的作品不变；已软删除作品不参与；
- 每批都经过 Worker lease fence，任务可取消、可观察、可安全重试。创建关系使用唯一约束去重，转换和删除再次限定原 provenance，避免覆盖并发人工编辑。

该校准只修改既有 `Tag` / `ArtworkTag` 数据，不新增数据库字段，因此没有 Prisma migration。正式回填前必须取得一致性数据库备份，先运行只读预检并保存结果；部署时 App 只会在新鲜 READY Worker 明确报告 `PIXIV_AI_DERIVED_TAG_SYNC@v1 / BACKGROUND_WRITER` 后允许入队。

## 状态与发布

引用状态统一为未检查、成功、部分成功、无数据和失败。成功或无数据会记录检查时间；失败保留错误码和可供单项重试的最近任务。磁盘已经发布但数据库事务失败时，重试会复用同内容文件并重新完成数据库发布。

生产发布前必须创建 PostgreSQL 与 `PIXISHELF_PUBLIC_DATA_PATH` 的一致性备份，部署 migration，确认 Worker READY/capability 后再开放 App。先选择少量作品验证状态、字段所有权、AI 派生标签、标签差异、磁盘快照和同步报告抽屉，再启动全部未检查作品；“刷新已有资料”也应先小批试跑。历史 AI 标签校准先执行只读预检，核对受影响数量和保护项后再正式回填。
