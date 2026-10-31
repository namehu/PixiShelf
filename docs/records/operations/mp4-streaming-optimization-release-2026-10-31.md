---
status: historical
scope: v0.55.11 MP4 无损播放优化与继承的去重待处理结果迁移的 patch 发布交接
last-verified: 2026-10-31
sources:
  - docs/records/features/mp4-streaming-optimization-2026-10-31.md
  - docs/records/dedup-pending-results-2026-10-31.md
  - packages/pixishelf-db/prisma/migrations/20261031000100_artwork_dedup_pending_results/migration.sql
  - .github/workflows/build-and-deploy.yml
---

# v0.55.11 MP4 优化发布交接

用户授权保留 main 期间改动、提交本轮修复、打 patch tag 并推送；NAS 由用户更新。本次不操作 NAS、生产数据库或媒体，不查询 GitHub 工作流、Release 或镜像状态，也不等待 CI 或镜像。推送结果以 Git 命令返回为准，不代表镜像已生成或生产已部署。

## 主线与版本

- fetch `origin/main` 和 tags 后，远程 main 为 `8f2046a2cfc42704f24cf96ebd73557c03dbcf01`，本地 main 已包含后续 `0a64e53a391ec30c2ca50a437f0b101fd0fa7355` 去重待处理结果收口提交，ahead 1／behind 0。MP4 改动本来就在当前 main 工作区，没有制造额外合并。
- MP4 功能提交为 `8dcb989c`，逐项暂存并核对 37 个明确文件：25 个主应用实现／测试，12 个功能／架构／权限文档与脱敏验收资产。提交父节点是上述 `0a64e53a`；该主线提交的 20 个文件 blob 全部保留，本轮范围外的 main 文件也逐项核对一致。
- 最新规范标签为 `v0.55.10`，忽略不符合单个 `v` 前缀的 `vv0.45.1`；本次使用 `v0.55.11` 附注标签，指向功能提交之后的发布记录提交。main 与新 tag 使用普通原子推送，不强推或移动已发布标签。
- 版本沿用 tag 注入 `APP_VERSION`，不修改 package versions、锁文件、部署资源或环境配置。

## 交付行为与验证依据

任务页按作品筛选、跨页选择 MP4，预览固定最多 1,000 个实际目标，再逐项入队并明确部分成功结果。普通入队、批量提交和 retry 共用同视频锁；失败重试保留父任务链与失败确认语义。任务历史和详情统一查看目标与完成体积，候选列表只展示作品与状态。当前规则见[MP4 无损播放优化](../../features/mp4-streaming-optimization.md)。

沿用[本轮验收记录](../features/mp4-streaming-optimization-2026-10-31.md)：lint、typecheck、production build、15 项显式隔离 PostgreSQL 回归、真实浏览器提交与 Worker 完成闭环均已通过。三个真实完成目标的 H.264／AAC 数据包哈希保持一致，faststart 布局已核对；部分成功、旧路径跳过零副作用、单作品历史范围、错误恢复和一次移动宽度抽样已有证据。

最终原命令全量测试为 **484 文件／3,594 tests 通过、51 文件／367 tests 跳过，1 文件／5 tests 失败**。唯一失败是 `artwork-dedup-display.test.ts` 的退役动作旧断言，独立 `git archive HEAD` 基线也为 5／5 同样失败；不登记为全量通过。原 fs mock 导出问题已修复，相关 9 项与归档来源列表 47 项在最终全量通过。integration、专用数据库未配置项及生产／真机／NAS 的限制仍按原记录保留。

本次发布准备只做明确文件／blob／祖先关系、tag 差异、文档链接、路径大小写和 whitespace 检查；按用户要求不重复 lint、typecheck、test、build、PG 或浏览器验证。主线去重读侧修复的独立专项与迁移证据沿用[待处理结果收口记录](../dedup-pending-results-2026-10-31.md)，不把两轮专项合称本次重新执行的全量验证。

发布准备检查：本轮范围外的 3,038 个 main 文件 blob 一致；文档检查 368 份 Markdown 通过，主应用路径无大写命中，`git diff --check` 通过。

## 继承迁移与 NAS 交接

**MP4 功能本身没有新增 migration，但整个 `v0.55.11` 相对 `v0.55.10` 包含主线新增迁移 `20261031000100_artwork_dedup_pending_results`。** 它增加派生视图 `ArtworkDedupPendingMember` 并替换 `artwork_dedup_group_choices` 的读侧来源与计数，不删除冻结检测成员、审核记录或删除报告；新 App 依赖该视图。MP4 隔离空库的 134 条迁移证据不替代这条后来主线迁移的专项证据。

用户确认目标镜像可取得后，按[标准发布](../../operations/deployment.md#标准发布)准备同点检查点，显式执行目标镜像的 `db:deploy`／`migrate deploy`，再开放新 App，并按现有流程核对配套 Worker 的 READY／capability。Compose 的目标 `IMAGE_TAG=v0.55.11`，App／Worker 分别为 `dockernamehu/pixishelf:v0.55.11`、`dockernamehu/pixishelf-worker:v0.55.11`；GHCR 为 `ghcr.io/namehu/` 同名镜像。本次不核验镜像可拉取状态，不执行迁移或 NAS 更新。

恢复依据见[备份基线](../../operations/backup-and-recovery.md#发布前一致性检查点)与[去重迁移恢复说明](../dedup-pending-results-2026-10-31.md#迁移及恢复依据)：仅换旧镜像不会恢复 SQL 查询语义；需要撤回该语义时，停写后采用经过审查的前向迁移和匹配代码，不手改 `_prisma_migrations` 或删除审计。MP4 已创建任务及媒体临时／备份文件继续遵循既有 Executor 恢复协议，界面回退不撤销媒体处理。
