---
status: historical
scope: F02 第一批视觉缓存读写优化、隔离性能对照、独立审查及桌面验收
last-verified: 2026-10-26
sources:
  - docs/design/artwork-deduplication/matching-extension.md
  - docs/features/artwork-deduplication.md
  - packages/pixishelf-job-executors/src/artwork-dedup/visual-pipeline.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/executor.postgres.test.ts
---

# F02 第一批：视觉缓存读写优化

## 版本与范围

基线 `a0ae9bce7577b6b065bb6cf6e5844be6526d5eba`，独立 worktree `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，分支 `codex/dedup-cache-batching`。实施 Astra/high，独立审查 Sol 6.1/xhigh，浏览器 Sol 6.1/medium。

本批只优化视觉准备阶段的数据库访问：每页最多 50 条身份与缓存预取，命中不写回持久特征，失效项及任务结果按已完成前缀提交。目录／根、作品快照、逐媒体身份及执行租约校验继续有效；不增加 Schema migration，不改变算法、页面、检测上限、三条 lane 或删除规则。跨次关系缓存、同 SHA 跨媒体视觉特征复用和规模扩展不在本批。

## 定向验证与审查

隔离 PostgreSQL 使用 `127.0.0.1:55432`，测试只用新合成 PNG 及临时目录；没有操作开发数据库、用户媒体或用户 App/Worker。恢复依据为独立样本生成代码、私有 manifest 和文件 SHA 清单，失败可重建隔离样本；不覆盖或恢复真实数据库。

- `executor.postgres.test.ts` 定向 10 项通过，另补全热预取后媒体类型变化 1 项通过，共 11 个不同用例。未选用例明确跳过，不称全文件通过。
- 覆盖冷／热／修改一张／FULL、跨 50 条分页、短前缀让行与续行、混合缓存、取消、失租约、源／目录变化及事务回滚。全热身份变化时零视觉调用／零缓存写，整批保持 PENDING，游标为 0，原缓存未变。
- `reader.test.ts` 15 项、`visual-experiment.test.ts` 9 项、`visual-matching.test.ts` 4 项，共 28 项单测通过；Executor typecheck 通过。
- [独立审查](./artwork-deduplication-cache-batch-f02-review-2026-10-26.md)通过，未发现阻塞缺陷。按审查意见补了稳定缓存访问断言和全热提交前身份变化用例，没有扩大生产改动。
- 必要产物构建仅包含 contracts、Executor 和 Worker。首次 Executor 构建因 worktree 旧 contracts dist 缺少已有维护任务版本导出失败；更新该依赖后定向重试通过。Worker 构建通过，保留既有三项 CJS/import.meta 警告。未运行全量 App lint/test/build。

## 真实文件 I/O 与数据库访问对照

相同 52 张合成 PNG、两部各 26 页，包含 25 对字节相同页和 1 对白边变体。旧实现通过 `git show` 导出到临时文件，再用 Vitest alias 指向它；未切换或覆盖工作区生产代码。修改一张通过同图重新编码改变字节身份。每轮都运行真实受控读取子进程及完整 executor，四轮关系与页配对证据相同。

| 检查     | 总 SQL：旧 → 新 | BEGIN 事务：旧 → 新 | 缓存 SELECT：旧 → 新 | 缓存写语句：旧 → 新 | 新版改写缓存行 | 视觉处理图片数 | 原件读取总字节 |
| -------- | --------------: | ------------------: | -------------------: | ------------------: | -------------: | -------------: | -------------: |
| 冷轮     |     3,259 → 995 |            217 → 63 |               52 → 2 |              52 → 2 |             52 |             52 |        121,594 |
| 未变热轮 |     3,090 → 824 |            211 → 57 |               52 → 2 |              52 → 0 |              0 |              0 |              0 |
| 改一张   |     3,184 → 920 |            214 → 60 |               52 → 2 |              52 → 1 |              1 |              1 |          9,466 |
| FULL     |     2,844 → 994 |            165 → 63 |                0 → 0 |              52 → 2 |             52 |             52 |        128,370 |

热轮总 SQL 减少约 73.3%，BEGIN 事务减少约 73.0%。查询统计包括 SHA、关系匹配、队列围栏和发布，不是单独视觉阶段；任务媒体结果仍写入数据库。缓存修改行按 updatedAt 前后核对；视觉处理数是成功的 `reader.visual` 调用／图片数，没有对 libvips 底层每次解码单独插桩。

冷轮视觉读取 60,797 B，热轮 0 B，改单张 4,733 B，FULL 64,185 B；原件总字节还包括 SHA 读取，所以冷轮／FULL 每张通常有 SHA 与视觉两次内容读取，改单张合计两次。冷热复用没有改变这些原件读取量，本批减少的是数据库访问。

同段 `executeArtworkDedup` 追加单次本机计时（非稳定基准）：冷轮 2,710 → 1,479 ms，热轮 1,897 → 817 ms，改一张 2,030 → 918 ms，FULL 2,631 → 1,334 ms。计时版新用例通过；旧 alias 跑完四轮及结果等价检查后，在最后的“新版缓存访问次数”断言按预期失败，不能把该日志称为测试全过。初次不含该新版次数断言的旧基线独立通过。追加只增加测试计时字段，未修改生产逻辑，耗时不作为 NAS 性能承诺。

## 桌面浏览器

新建 `dedup_cache_browser` 隔离数据库，App `localhost:5483`、Worker 健康端口 `55824`，合成 A/B/C 各 10 张；A/B 8 张视觉相近但字节不同，各 2 张未配对，C 为负例。使用 `entry=direct`。

浏览器开启“检查疑似版本”完成冷查及热查，两次均只出现 A/B 一组、8 个配对、双方各 2 个未配对；相近和未配对图片正常显示，刷新结果保留。手选 A 并打开确认面板后关闭，没有勾选删除声明或执行删除。只读审计为准备操作 READY、已删文件 0，全部 30 个原文件 SHA 未变。

冷查 `043642d5`、热查 `4c27bf50` 为记录 ID 前缀，两次均 COMPLETED。截图 6 张在下述浏览器证据目录，主 agent 实际打开核对了热检查结果与并排图片对照。刷新后的 warning/error 读取为空。隔离环境普通仪表盘的 ImgProxy 缩略图初次加载失败，不作为全站媒体验收通过；去重同源封面和图片对照正常。本批没有手机回归，也没有重新执行永久删除流程。

## 证据、交付与剩余工作

- 核心原始日志和结构化度量：`/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-cache-f02-20261026/`。
- 浏览器截图、console、文件审计与报告：同一父目录下 `dedup-cache-f02-browser-20261026/`。私有启动及重建脚本在 `/private/tmp/pixishelf-cache-f02-browser/`，不含入库源码变更。
- 本地 52 图测量不代表真实图库识别率、NAS 耗时或 50 万规模；当前视觉上限不变。关系仍逐次重新匹配，同 SHA 跨媒体特征复用仍未做。
- `pnpm docs:check` 通过（278 份 Markdown）；图示检查默认 Chromium 缺失，改用项目文档支持的 `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 后通过（33 个图源、23 处内嵌 Mermaid）。图源未修改，未重新生成 SVG。diff 检查通过，主应用路径大小写搜索无匹配。
- 隔离 App/Worker 已停止，5483/55824 已无监听；准备记录保留为 READY，关闭确认面板不等于业务取消。私有脚本可重启验收环境。主目录仍为 `a0ae9bce` 且工作区干净。
- 本批在独立分支提交后暂停，不合入主目录、不发布镜像、不升级用户开发服务。
