# TODO

## PostgreSQL 与列表性能优化

按以下顺序逐项实施；每项完成后运行窄范围测试，并用生产查询指标验证收益。

- [x] 限制作品列表页大小、卡片只查询封面、后续页取消 `COUNT(*)`
  - 将普通作品列表的 `pageSize` 上限从 10,000 收紧到 100。
  - 卡片接口只选择卡片字段和每个作品的第一张媒体；Viewer/详情继续加载完整媒体。
  - 第一页返回精确总数；后续页通过多取一条记录判断 `hasNextPage`，不再重复统计总数。
  - 验收：普通列表不加载完整图片数组；Viewer 行为不变；分页边界有测试覆盖。
  - 已完成：新增轻量 `artwork.cardList`；公开瀑布流已切换，后台表格与 Viewer 保持原数据契约。
  - 已兼容：若封面为 APNG，则按批次补查并优先使用同名 WebM/MP4 作为逻辑视频封面；独立 APNG 仍保留。

- [x] 重写搜索建议，直接使用 `Artwork.imageCount` / `Tag.artworkCount`
  - 移除作品建议查询对 `Image` 的联表计数。
  - 标签建议直接读取已经由触发器维护的 `artworkCount`。
  - 验收：建议内容和排序不回退，查询不再为计数扫描关联表。
  - 已完成：作品建议移除 `Image` 联表计数和 `GROUP BY`；标签建议移除关联 `_count`，返回结构与排序保持不变。

- [x] 添加 `ArtworkTag(tagId, artworkId)` 索引，改造标签统计和触发器日志
  - 为按标签反查作品、标签计数和标签删除补反向复合索引。
  - 将逐标签 `COUNT + UPDATE` 改为集合式聚合更新。
  - 将标签计数触发器改为语句级批量更新，正常成功操作不再逐条写审计日志。
  - 清理 `TriggerLog` 重复索引，并把日志保留策略接入定时维护。
  - 验收：标签统计只扫描关联表一次；批量导入不产生与关联数线性增长的成功日志。
  - 已完成：新增反向复合索引和语句级增量触发器；部署迁移时会集合式校准存量计数并删除三组重复索引。
  - 已完成：手动标签统计改为单条集合 SQL；触发器成功操作不再写日志，30 天日志清理任务已按每天 02:00 注册并默认启用。

- [ ] 媒体筛选切换到 `Image.mediaType`，再验证图片复合索引
  - 视频/图片筛选不再依赖 `LOWER(path) LIKE '%扩展名'`。
  - 用生产 `EXPLAIN (ANALYZE, BUFFERS)` 验证是否需要 `(artworkId, mediaType)` 和 `(artworkId, sortOrder, id)`。
  - 验收：筛选结果兼容旧数据；必要索引有执行计划依据。
  - 已完成代码：粗粒度图片/视频及未知音频筛选改读 `Image.mediaType`；精确格式筛选仍按扩展名工作。
  - 已完成代码：扫描、批量导入和图片管理的新媒体会在入库时写入 `mediaType`，APNG/GIF 为 `ANIMATION`，WebM/MP4 等为 `VIDEO`。
  - 待生产验收：先运行视频媒体探测清空历史 `UNKNOWN`，再执行 `prisma/diagnostics/media-filter.sql`；根据计划决定是否添加两个候选复合索引。

- [ ] 将作品列表从 OFFSET 页码分页改成 keyset pagination
  - 默认时间排序使用稳定的 `(sourceDate, id)` 游标。
  - 为其他排序定义稳定次序和游标编码，保留必要的兼容迁移方案。
  - 验收：连续翻页无重复、无遗漏；深分页耗时不随页码线性增长。

- [ ] 在生产启用 `pg_stat_statements`，采集一周后再决定是否引入 Redis
  - 记录调用次数、总/平均执行时间、共享块读取、临时块和连接池等待。
  - 汇总 Top SQL，并对候选慢查询执行 `EXPLAIN (ANALYZE, BUFFERS)`。
  - 仅当 SQL 优化后仍存在高频重复读取、数据库负载或多实例共享缓存需求时引入 Redis。
  - 验收：形成一周数据报告和明确的 Redis 引入/暂缓结论。

## 移除 Thumbor 视频截帧服务

状态：待处理

### 背景

视频封面链路已经调整为：

- 使用 FFmpeg 提前生成静态 WebP 封面。
- 使用 ImgProxy 对静态封面进行缩放、格式处理和缓存。
- 静态封面不存在或生成失败时显示占位图，不再实时截帧。
- 作品详情、全屏预览和沉浸浏览继续通过视频播放器加载原始视频。

因此，Thumbor 已经不在正常业务链路中使用。目前仅在 `packages/pixishelf/lib/image-loader.js` 中保留一个兼容兜底：当原始视频路径被直接传给 `next/image` 时，通过 Thumbor 的 `filters:still(1)` 实时截帧。

### 后续清理事项

- [ ] 再次确认所有封面和缩略图入口都使用 `MediaThumbnail`，不存在把原始视频路径传给 `next/image` 的场景。
- [ ] 移除 `image-loader.js` 中的 Thumbor 地址和视频实时截帧分支，并为误传视频路径保留明确的占位或错误处理。
- [ ] 移除 `NEXT_PUBLIC_THUMBOR_VIDEO_URL`、`THUMBOR_HOST_PORT` 及构建时环境变量替换逻辑。
- [ ] 从开发和部署 Docker Compose 中移除 Thumbor 服务、端口、卷挂载及相关路由。
- [ ] 删除 `build/thumbor` 镜像构建配置。
- [ ] 更新 `README.md`、`DEPLOYMENT.md`、架构文档和代理启动说明中的 Thumbor 内容。
- [ ] 停止并删除现有 `thumbor_video` 容器。
- [ ] 回归验证普通图片、静态视频封面、封面缺失占位、视频播放以及 GIF/WebP 处理链路。

### 注意

在代码、环境变量和部署配置清理完成前，不直接永久删除 Thumbor 配置，以免遗留页面触发旧兜底后出现不可定位的图片加载失败。
