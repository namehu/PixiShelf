---
status: historical
scope: v0.55.6 热批核对回退修复合并与 patch 发布交接；NAS 由用户更新
last-verified: 2026-10-30
sources:
  - docs/records/artwork-deduplication-hot-batch-fallback-2026-10-30.md
  - packages/pixishelf-db/src/artwork-dedup-hot-run.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/hot-run.ts
  - .github/workflows/build-and-deploy.yml
---

# v0.55.6 热批核对回退修复发布交接

用户授权合回 main、准备 patch tag 并推送，NAS 由用户更新。本轮不操作生产数据库、媒体或容器，不查询 GitHub 工作流、Release 或镜像状态；推送结果以 Git 返回为准，不宣称镜像已经生成。

## 合并与版本

- 修复提交 `846bddb0d9bf2f7df2362e7b2245225f790c8de5`，来源分支 `codex/dedup-hot-batch-fallback`。
- fetch main 与标签后，本地 main、origin/main 均为 `f2b7e20f65bce707e0df3c8cf1341a07f5c89380`，主目录与暂存区干净。修复分支包含全部主线，已通过 `--ff-only` 合并，无代码冲突。
- 主线期间的 `478f9d75` 视频阅读统计测试、`190187bf` 作品筛选与艺术家快捷筛选、`f2b7e20f` 单图点赞与双击反馈完整保留；未改其他分支或 worktree。
- 最新正式版本为 `v0.55.5`，本轮使用 `v0.55.6`。发布提交仅补本交接及索引；main 和附注标签原子推送，不强推、不移动已有标签。
- App 版本由标签作为 `APP_VERSION` 构建参数传入，不修改包版本、锁文件或部署配置。相对 `v0.55.5` 无 Schema、迁移、执行协议或检查点格式变化。

## 修复与验收依据

生产 53 部作品没有作品级内容源记录，既有合法含义是版本/epoch 为 0。新热批路径错误要求该记录存在，导致全部回退为逐作品处理。本次统一预载和提交的默认 0 判断，保留真实非零版本、写入、成员、目录和执行权核验；无需补数据或清缓存。

补充有限原因枚举的 `artwork-dedup.hot-fallback` 日志及任务事件，包含阶段、相关 ID、发生时最近已提交进度。事件随已有事务保存，不增加逐图日志或事务；未采样内存不再写成伪零。动图规则、相似算法、删除流程和 1 万原件上限不变。

同一份 2,000 图片/50 作品暖缓存样本，在两份独立克隆中构造相同合法缺源条件，各测一次：

| 指标              |   修复前 |                  修复后 |
| ----------------- | -------: | ----------------------: |
| 本机耗时          | 8.065 秒 | 3.091 秒（减少 61.67%） |
| 实际 SQL BEGIN    |      471 |       24（减少 94.90%） |
| 实际 SQL 条数     |    7,724 |                     704 |
| 成功热批/复用作品 |      0/0 |                    4/50 |

结果摘要一致，读取、哈希、解码、候选与精比均为零。数据是本机单次隔离观测，不换算为 NAS 秒数。详细范围、失败归因、原始日志和源码摘要见[实施与验收记录](../artwork-deduplication-hot-batch-fallback-2026-10-30.md)。

沿用已完成的单元/日志专项 28 项、PostgreSQL 32 个不同场景组合覆盖（30 项通过后修正两个新增断言、定向通过 2 项）、DB/执行器类型检查与必要 Worker 构建；独立审查无未解决 P1/P2。桌面实际快检、刷新、暂停在 1,000 项、继续至 2,000 项/50 作品/25 组、打开结果均通过；未删除媒体，临时延迟及自建服务已清理。

此次快进合并未改变已验收源码，不重复专项、全量 lint/test/build 或浏览器回归。只核对 Git 范围、源码一致性、迁移差异、文档链接和发布标签；图源/SVG 未变，沿用本轮已通过的 34 份图源、23 段内嵌 Mermaid 检查。

## NAS 交接

用户确认流水线与两镜像生成后，按[标准更新流程](../../operations/deployment.md#标准发布)成对更新 App/Worker 至 `v0.55.6`。Compose 使用 `IMAGE_TAG=v0.55.6`；目标为 `dockernamehu/pixishelf:v0.55.6`、`dockernamehu/pixishelf-worker:v0.55.6`（GHCR 对应 `ghcr.io/namehu/` 同名镜像）。这里仅登记目标，不核验可拉取状态。

本补丁无新增迁移，不需要重新授权诊断账号、清理旧检查或使有效缓存失效。保留更新前配套镜像与例行备份，恢复依据沿用[备份恢复基线](../../operations/backup-and-recovery.md)；本轮未执行 NAS 更新或备份操作。

更新后，可对艺术家 2812 在输入及选项不变时做快速检查，保存 runId，比较成功热批、复用作品、耗时、事务与关系复制。若仍回退，使用[回退原因只读模板](../../operations/queries/artwork-dedup-hot-fallback.sql)定位；两轮比较使用[运行对比模板](../../operations/queries/artwork-dedup-run-compare.sql)。生产 API 调用不冒充精确 SQL 条数；生产提速结论留待实际观测。
