---
status: historical
scope: MP4 工作页逐视频优化记录、尺寸与详情入口的隔离验证
last-verified: 2026-11-07
sources:
  - packages/pixishelf/services/video-optimization-batch-service.ts
  - packages/pixishelf/app/admin/tasks/video-streaming-optimization/_components/video-streaming-optimization-workspace.tsx
  - packages/pixishelf/services/__tests__/video-optimization-batch.postgres.test.ts
---

# MP4 视频信息验证

2026-11-07，在提交 `3c58e20528c043ed49271812e420dde9af497414` 基础上的工作区验证。当前规则见 [MP4 优化规格](../../features/mp4-streaming-optimization.md)。本次只补充读取与展示，没有新增 migration，没有访问生产数据库或提交生产任务。

## 变更与语义

- 作品行显示曾优化成功的 MP4 数量；展开后逐视频显示文件名、分辨率、文件大小、最近任务及历史成功记录。
- 成功后再次失败仍保留「曾优化成功」；无成功依据显示「暂无成功记录」，不据此判断当前文件的 faststart 布局。
- 分辨率缺失或非正值显示未知；文件大小以十进制字符串传输，显示时格式化。旧任务缺少完成时间不抹去成功事实。
- 作品详情和视频链接使用现有详情页，视频链接携带 `mediaId`，新标签页保留当前列表状态。关闭链接预取。
- 当前页补元数据，展开不额外请求。任务时间在 SQL JSON 序列化时显式携带时区，避免浏览器按本地时间误读 UTC 数据。

## PostgreSQL 与性能

使用独立 PostgreSQL 15 容器、临时数据目录和显式 `PIXISHELF_TEST_DATABASE_URL`。空库通过现有 141 个正式 migration，未使用 `db:push`。合成数据为 21,604 部作品、1,855,523 条媒体、1,601 个 MP4、31,225 条任务；其中 50 个视频先成功后失败，MP4 集中在较早作品。

从上一提交加载原服务，与本次实际参数化 SQL 在同一库比较；各预热 1 次、采样 20 次，p95 取升序第 19 个样本。这是 Prisma 查询往返时间，包含结果读取，不是 HTTP 接口或生产 NAS 延迟。

| 查询               | p50      | p95      | 代表性 SQL 执行时间 |
| ------------------ | -------- | -------- | ------------------- |
| 上一版已优化查询   | 16.88 ms | 18.45 ms | 16.55 ms            |
| 补充当前页视频信息 | 17.38 ms | 19.40 ms | 18.29 ms            |

当前页多读取视频与历史信息后仍低于 500 ms 目标。候选使用 `Image_mp4_artwork_id_idx` 的 Index Only Scan，读取 1,601 行；新增当页媒体、最近任务和成功历史分支各执行 20 次。任务分支命中现有 payload / legacy 图片历史索引，没有媒体或任务全表扫描。代表性计划新增成功分支平均过滤 1 条失败记录。高频重复执行、历史极多的单视频不在该样本中。

移除新增 `videos` 字段后，默认列表、越界页及成功／失败筛选的旧字段、顺序和总数与上版一致。样本与扫描节点证据见 [JSON](../evidence/mp4-video-information-2026-11-07.json)。未将本次补信息称为进一步提速，也未重做上一轮完整性能矩阵。

## 验证结果

- 聚焦实施测试：4 文件、23 项通过；独立审查：5 文件、46 项通过，包含详情定位、失效目标降级和接口鉴权。
- 独立 PostgreSQL：8 项通过，使用 `TZ=America/Los_Angeles` 核对 UTC instant；覆盖多视频、空尺寸、零尺寸、超出 JavaScript 安全整数的原始大小、旧版任务、同时间戳排序、成功后失败，以及现有批量边界。
- 主应用 `pnpm lint`、`pnpm typecheck` 通过；`TZ=UTC pnpm test` 为 514 文件、3,810 项通过，54 文件、395 项按环境条件跳过。相关 PostgreSQL 测试另行显式执行，不把全量测试的跳过计为通过。
- 窄屏局部修复后，组件 14 项再次通过，最终提升权限 `pnpm build` 通过。文档检查通过 396 份 Markdown、34 份图源与 23 个内嵌 Mermaid；路径大小写和 `git diff --check` 通过。

浏览器验证使用系统 Chrome、真实工作区组件与样式、隔离 Vite 页面和内存 tRPC fixture，并在 URL 设置 `entry=direct`。其范围是页面布局、交互和生成的导航链接；后端查询由 PostgreSQL 测试验证，详情媒体定位由既有路由测试验证。没有启动生产媒体读取或真实任务提交，不能把该 fixture 当成生产登录与播放器联调。

16 项浏览器断言通过，无页面／控制台错误。首进与编辑草稿零候选请求，应用仅一次，展开与新标签跳转不增加请求；成功后失败、旧成功时间未知、空尺寸和零大小均按预期显示。新标签实际请求目标为 `/artworks/83?mediaId=8303`，目标内容由 fixture 拦截，原页选择保留。

桌面为 1440 px，窄屏为 390 px。首轮发现展开区域随表格横向宽度拉伸，已局部修正；最终展开内容与表格可视区均为 356 px，长文件名在可视区内换行，文档宽度仍为 390 px。表格继续独立横滚。

截图：[桌面](./assets/mp4-video-information-2026-11-07/desktop-metadata.png)、[窄屏](./assets/mp4-video-information-2026-11-07/narrow-metadata.png)。截图使用合成作品和任务，不包含真实收藏。

验证结束后已停止并移除本轮专用 PostgreSQL 容器、Vite 和 Chrome，清理合成数据库、临时脚本与源日志；保留上方脱敏证据和截图。既有业务容器未停止或修改。代码回退不涉及数据库变更。
