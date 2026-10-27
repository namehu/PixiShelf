---
status: historical
scope: F01–F03 当前验收范围的镜像发布与 NAS 交接；不证明生产已升级
last-verified: 2026-10-27
sources:
  - docs/features/artwork-deduplication.md
  - docs/design/artwork-deduplication/matching-extension.md
  - .github/workflows/build-and-deploy.yml
  - docs/operations/runbooks/artwork-deduplication.md
---

# 去重 F01–F03 发布交接

本轮准备发布 `v0.54.11`，上一正式版本为 `v0.54.10`。用户负责更新 NAS；本轮不访问生产数据库或媒体，不继续 F03 大规模扩展。

## 发布范围

- **部分重复**：同一艺术家的两部作品可展示共同页和各自不同页，例如双方各 100 张、共享 80 张。对照后明确选择保留整部作品，单对确认删除；不是从两部作品拼出图片合集。
- **缓存复用**：按批读取和保存视觉特征；复用兼容的已完成作品关系；相同文件内容可共享已核验特征。完整检查仍绕过复用。
- **分段与查询优化**：视觉索引、查询、配对持久保存进度，暂停及 Worker 正常退出后可继续。QUERY 有界批处理减少重复数据库往返，提交时保留执行、来源和目录校验。
- **桌面流程**：沿用已验收的检查、图片对照、确认和删除记录。文件取舍与删除不提供移动端处理入口。

主目录原为 `261993af`，干净工作区；远端 `main` 为 `2b184aca`。本轮将已验收的 F03 分支快进到 `fdf4fc31`，保留原有主线提交，没有覆盖、重置或丢弃主线改动。

## 验收依据与边界

复用已有[部分重复验收](../artwork-deduplication-partial-overlap-f01-2026-10-26.md)、[缓存批处理](../artwork-deduplication-cache-batch-f02-2026-10-26.md)、[关系复用](../artwork-deduplication-relations-f02-2026-10-26.md)、[共享特征](../artwork-deduplication-shared-visual-cache-f02-2026-10-27.md)、[分段检查](../artwork-deduplication-visual-batches-f03-2026-10-27.md)及[F03 第三批验收](../artwork-deduplication-query-batching-f03-2026-10-27.md)。独立审查与浏览器记录见各验收文档链接。

- 同一批 10,001 条预制特征，SQL 从 381,105 降至 63,285（约 83%）；单次内核耗时 419,456 ms → 111,205 ms。比较数、关系与结果摘要一致。这不是实际原图解码或 NAS 吞吐测试。
- 3,030 张合成 PNG 的实际浏览器检查覆盖运行中暂停、继续、Worker **正常退出**后同任务续跑，并与独立完整检查比对。未把它写成强制崩溃或租约超时接管验收。
- **疑似版本每次仍最多 10,000 个登记原件，每作品或配对最多 2,000 个文件**，预算不足明确显示未完成。没有结果不代表没有重复，视觉相近不代表已判定无码或可以自动删除。
- 10 万／50 万、密集模板预算续行、NAS 并发与真实版本准确率继续留在[后续计划](../../design/artwork-deduplication/matching-extension.md)和根 [TODO](../../../TODO.md)。它们不作为当前有限范围发布的完成声明。

本轮不重复本地全量 lint、test、build。仅补实际发布阻塞的定向验证、文档检查及合并检查；标签触发仓库既有 CI 与镜像发布门禁，不跳过或弱化远端验证。

发布前修复一个已有 Next 路由导出问题：将任务 SSE 的 `createJobEventStreamResponse` 及内部实现从 `app/api/jobs/events/route.ts` 原样移入相邻 `stream-response.ts`；测试只改导入位置。路由只导出 `GET` 和 `dynamic`，认证、游标验证、事件格式及取消行为不变。GPT-6.1 Sol / xhigh 实施与另一独立同模型审查完成，审查逐字比较函数体并对照本地 Next 检查器，无阻塞项。接口 13/13 测试、三文件 oxlint/格式检查通过；没有追加本地全量类型检查或构建。

文档检查 293 份 Markdown 通过；图示检查 33 个图源、23 个内嵌块通过。首次图示检查因沙箱无法启动 Chrome 失败，允许本机 Chrome 启动后原命令通过。主应用路径大小写扫描无命中，差异空白检查通过。

## 发布状态

准备中。最终标签提交、CI、两份镜像及 GitHub Release 的结果以本节后续实际证据为准；当前不声明镜像已发布。

## NAS 升级

发布成功后将实际 Compose 使用的 `IMAGE_TAG` 统一设为 `v0.54.11`。标准 Compose 使用 `dockernamehu/pixishelf` 和 `dockernamehu/pixishelf-worker`；也可使用 GHCR 的 `namehu/pixishelf`、`namehu/pixishelf-worker` 同版本镜像。发布平台为 `linux/amd64`，App 和 Worker 必须成对更新。

从 `v0.54.10` 升级新增四项正式迁移，不在迁移时读取媒体：

| 迁移                                               | 作用                       |
| -------------------------------------------------- | -------------------------- |
| `20261026000100_artwork_dedup_partial`             | 部分重复关系及约束         |
| `20261026000200_artwork_dedup_relation_cache`      | 已完成关系的复用摘要及计数 |
| `20261027000100_artwork_dedup_shared_visual_cache` | 相同内容特征共享字段及索引 |
| `20261027000200_artwork_dedup_visual_batches`      | 分段检查点及本次运行工作表 |

遵循[标准发布步骤](../../operations/deployment.md#标准发布)和[去重升级手册](../../operations/runbooks/artwork-deduplication.md)：停调度及外部写入，等待任务收口，再停旧 App/Worker；核验同点备份后拉取配套镜像；以目标 App 镜像运行正式 `prisma migrate deploy`；启动新 Worker 并核对 READY、完整 capability；最后开放 App 和原本启用的调度。不得使用 `db:push`。

新检查要求扫描 v5，维护使用 v5；旧任务兼容范围以目标 Worker 的能力清单为准。活动 v5 扫描不能改版本交给旧 Worker。存在未结束删除操作时，不得降级到不理解其协议的版本；已经删除的原件不能靠镜像回滚恢复。不要删除新增表或字段来回退优化。

上线后先选小艺术家观察检查结果、缓存复用与暂停继续，再用可销毁样本确认对照和删除。用户更新 NAS 后的实际版本、备份与观察结果尚待登记。
