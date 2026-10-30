---
status: historical
scope: v0.55.3 热检查整轮复用合并与 patch 发布交接；NAS 由用户更新
last-verified: 2026-10-30
sources:
  - docs/records/artwork-deduplication-hot-run-reuse-2026-10-30.md
  - packages/pixishelf-db/prisma/migrations/20261030000100_artwork_dedup_hot_run_reuse/migration.sql
  - .github/workflows/build-and-deploy.yml
  - docs/operations/deployment.md
---

# v0.55.3 热检查整轮复用发布交接

用户授权将已验收的热检查优化合回 main、准备 patch tag 并推送，NAS 由用户更新。本轮不操作生产数据库、媒体或容器，不查询 GitHub 工作流和镜像状态。

## 合并与版本

- 功能提交 `92ce1e7f46e4c129ac170ba11ac262f66113e4ac`，来源分支 `codex/dedup-hot-run-reuse`。
- fetch origin 与标签后，本地 main、origin/main 均为 `c8d1f380dc898986eb1e0a6f65cae1487724ddeb`，主目录与暂存区干净。来源包含完整主线，没有分叉或期间新增主线提交；已快进合并，无代码冲突，保留既有历史和其他 worktree。
- 最新正式标签为 `v0.55.2`，目标为 `v0.55.3`。发布提交只补交接文档，功能代码保持已验收内容；main 与附注标签一起原子推送，不强推或覆盖已有标签。推送成功以 Git 返回为准，本记录不证明镜像已经生成。
- App 版本由发布标签作为 `APP_VERSION` 构建参数传入，不修改包版本、锁文件或部署配置。

## 改动与已有验收

资料按页读入任务内存，未变化原件批量核对、一次提交；直接复用有效作品指纹。整轮输入、选项和证据兼容时，在数据库内复制本次独立结果，跳过关系候选、视觉特征整理和检索，不复制人工选择或删除授权。必要提交及发布核验继续保留；动图规则、四类关系、删除流程和 1 万原件上限不变。

同一份 2,000 图片／50 作品暖缓存样本，v0.55.2 → 本轮：

| 指标 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 本机执行耗时 | 12.448 秒 | 3.475 秒（减少 72.1%） |
| 实际 SQL 事务（BEGIN，含队列） | 666 | 24（减少 96.4%） |
| 实际 SQL 条数（含控制语句） | 12,741 | 704 |

两侧结果摘要一致；优化后读取、哈希重算、解码和候选检索均为零。以上是本机单次对比，不承诺 NAS 同比例或固定秒数。完整口径、限制和原始证据见[实施与验收记录](../artwork-deduplication-hot-run-reuse-2026-10-30.md)。

已有核心 PostgreSQL 专项 28/28、内存专项 5/5、受影响契约／运行时／Worker 专项、类型检查及必要 Worker 构建通过；独立审查无未解决 P1/P2。真实 Worker 在原件与复制边界重启续跑通过。桌面暂停／刷新／继续、四类关系图片对照和确认通过；经用户批准，仅删除隔离合成作品 B（52），保留作品与原件审计一致。详情原图因隔离 imgproxy 未映射样本根而未渲染的环境限制仍保留，不能算作该页面图片渲染验收。

此次合并未改变功能代码，只检查合并范围、迁移差异、发布文档链接与 Git 差异；不重复全量 lint/test/build 或已有专项。图源与生成结果沿用本轮已通过的渲染／检查。

## NAS 更新要点

1. **升级前**，如果还有未完成旧去重检查，先在 v0.55.2 的去重页取消，等待任务终态和读取进程收口；已完成记录不用取消或删除。新 Worker 只注册扫描 v9，不续跑旧扫描。只读排查 SQL 见[实施记录](../artwork-deduplication-hot-run-reuse-2026-10-30.md#未来升级前的旧扫描处理本轮不执行生产操作)。
2. 按[标准发布](../../operations/deployment.md#标准发布)停写并保留[同点备份与恢复依据](../../operations/backup-and-recovery.md)。本轮新增 `20261030000100_artwork_dedup_hot_run_reuse` 迁移，仅扩展任务策略约束以接受扫描 v9，不增加表、不删除历史数据、不清空有效缓存。使用目标 App 镜像执行 `prisma migrate deploy`，不要使用 `db:push`。
3. 用户确认标签流水线与两镜像成功后，成对更新 App／Worker 为 `v0.55.3`，核对 Worker READY 和 capability 后开放 App／调度，不让新旧 Worker 混跑。本轮没有代用户执行上述生产操作。

目标镜像为 `dockernamehu/pixishelf:v0.55.3`、`dockernamehu/pixishelf-worker:v0.55.3`；GHCR 对应 `ghcr.io/namehu/pixishelf:v0.55.3`、`ghcr.io/namehu/pixishelf-worker:v0.55.3`。Compose 使用 `IMAGE_TAG=v0.55.3`。这里只登记目标，不查询可拉取状态。

升级后，在艺术家 2812 输入不变、检查选项一致时发起普通快速检查，保留 runId，用[运行对比查询](../../operations/queries/artwork-dedup-run-compare.sql)核对总耗时、属性检查、整轮复用／复制、事务数及读取／解码／候选为零。不要用完整检查衡量热缓存。生产收益留待用户更新 NAS 后采集。

## 回退边界

保留 v0.55.2 配套镜像及升级前恢复集合。新版本可能创建 v9 任务及 v4 复用检查点，不能假设旧 Worker 能接管；有问题时先停调度并保存现场，优先前向修复。必须降级时按备份恢复手册隔离验证数据与任务兼容性，再由管理员执行恢复；不直接强改任务状态、删除缓存或反向收紧已存在 v9 历史行的约束。
