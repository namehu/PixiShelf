---
status: historical
scope: v0.55.2 热检查优化合并与 patch 发布交接；NAS 由用户更新
last-verified: 2026-10-30
sources:
  - docs/records/artwork-deduplication-hot-check-2026-10-30.md
  - .github/workflows/build-and-deploy.yml
  - docs/operations/deployment.md
---

# v0.55.2 热检查优化发布交接

用户在提交暂停后授权合回 main、准备 patch tag 并推送；NAS 更新由用户执行。本轮不操作生产数据库、媒体或容器，不查询 GitHub 工作流或镜像状态。

## 合并与版本

- 功能提交 `e3cf18026a5bcf7cc3d3c577f7907be99c6ab5da`，分支 `codex/dedup-hot-check-batching`。
- 拉取远端 main 和标签后，本地 main、origin/main 均为 `a46438f613a95a63fe2e348b61a2fbf336d07cc7`，主目录与暂存区干净；没有分叉或期间新增主线提交，可以快进，不重写既有历史。
- 最新正式标签为 `v0.55.1`，本次目标 `v0.55.2`。发布只补交接文档，功能文件保持已验收内容；main 与新标签一起原子推送，不强推、不覆盖已有标签。是否推送成功以本次 Git 返回为准，本记录不证明镜像已经生成。
- App 显示版本由标签作为 `APP_VERSION` 构建参数传入；不修改工作区包版本、锁文件或部署配置。其他 worktree 与功能分支保持原状。

## 本轮内容与证据

未变化原件按最多 100 个一批，在写事务外读取资料和检查属性；缓存及绑定有效时一次事务统一核验并保存媒体、游标和计数。无内容读取或解码的 v8 执行片让行后立即重新排队；实际读取片保留冷却。安全核验、失败退避、用户暂停、检查上限和最终发布行为不变。

[实施与验收记录](../artwork-deduplication-hot-check-2026-10-30.md)包含独立审查、28 项专项、DB/executor 类型检查、桌面暂停／刷新／继续、真实 Worker 重启和截图。留存同一份 2,000 原件样本：总耗时 32.769→25.196 秒（减少 23.11%），执行器提交事务 814→666，结果一致；读取、解码和候选检索均为零。固定 3 秒冷却已取消，记录中的 7 毫秒仍保留为真实结算间隔。该本机单次对比不承诺 NAS 上的绝对耗时。

合并没有代码冲突，也未修改已验收功能。本次只做 Git 合并范围／迁移差异核对、交接文档链接与差异检查，不重复全量 lint/test/build 或上一轮专项。图源与生成结果沿用上一轮已通过的检查，不重新生成。

## NAS 交接与恢复依据

用户确认标签流水线和两镜像成功后，成对更新：

- `dockernamehu/pixishelf:v0.55.2`
- `dockernamehu/pixishelf-worker:v0.55.2`

GHCR 对应 `ghcr.io/namehu/pixishelf:v0.55.2` 和 `ghcr.io/namehu/pixishelf-worker:v0.55.2`。Compose 使用 `IMAGE_TAG=v0.55.2`。上述是目标镜像名，本轮不查询是否已可拉取。

相对 `v0.55.1` 没有新增 schema 或迁移，不改变任务协议、检查点格式、特征或关系缓存版本；无需清空有效缓存。动图仍标为未核对，静图正常参与；相似算法、删除流程和 1 万原件上限不变。

沿用[标准发布](../../operations/deployment.md#标准发布)及[备份恢复](../../operations/backup-and-recovery.md)：让活动任务经正常业务流程收口，保留同点数据库／媒体备份和原 App/Worker 镜像，更新时不让新旧 Worker 混跑。原版本 `v0.55.1` 与本轮 schema 和任务协议兼容；若需程序回退，正常停止执行后成对恢复原镜像，保留现有数据库、缓存和检查点，不反向迁移或删记录。本轮未替用户创建生产备份或执行部署。

生产效果可在艺术家输入不变时发起一次普通快速检查（需要视觉结果时保持疑似版本选项一致），不要用完整检查衡量热缓存；保存 runId，使用[运行对比 SQL](../../operations/queries/artwork-dedup-run-compare.sql)对比前置耗时、总耗时、数据库 API／事务与冷却，并确认读取、解码和候选检索仍为零。生产实测留待 NAS 更新后登记。
