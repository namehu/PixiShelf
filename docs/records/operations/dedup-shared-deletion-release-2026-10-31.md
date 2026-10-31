---
status: historical
scope: v0.55.9 去重复用普通作品删除的合并与 patch 发布交接；NAS 由用户更新
last-verified: 2026-10-31
sources:
  - docs/records/dedup-shared-deletion-2026-10-31.md
  - docs/operations/runbooks/dedup-shared-deletion-upgrade.md
  - .github/workflows/build-and-deploy.yml
---

# v0.55.9 去重删除发布交接

用户授权合回 main、准备 patch tag 并推送，NAS 由用户更新。本次不操作生产数据库、媒体或容器，不查询 GitHub 工作流、Release 或镜像状态；推送结果以 Git 返回为准，不代表镜像已经生成。

## 合并与版本

- 实施提交 `e85342ca0f937923b93d77e8e5a8624447878a94`，来源分支 `codex/dedup-use-artwork-delete`，基线 `6007ba700622deecb6ecadd753519b8f1febeec9`。
- 开始时主目录和暂存区干净。fetch 后 origin/main 为 `6825fddc`，本地 main 为 `ac5c1de6`，包含尚未推送的 `39b715f7` 预览自动播放修复和 `ac5c1de6` 详情页导航修复。
- 使用普通合并生成 `6eb66f70c15a75eea11398d7ac56b8f16b66e3e9`，无冲突。按 Git blob 逐项核对：删除改造的 92 个文件与实施提交一致，主线期间的 20 个文件与合并前 main 一致。保留全部主线提交及其他 worktree。
- 最新正式标签为 `v0.55.8`，本次使用 `v0.55.9`；附注标签和 main 原子推送，不强推或移动已有标签。本交接与记录索引另作发布提交。
- App 版本沿用 tag 注入 `APP_VERSION`，不修改包版本、锁文件或部署配置。本次没有 Schema 或数据库迁移。

## 交付行为与验证

检查结果页可勾选待处理作品，一次确认后交给普通作品删除核心执行；疑似版本和部分重复须先明确保留方。确认后留在结果页查看进度，刷新仍可继续查看。四类关系、四种来源可混批；归档作品沿用七天回收站，其他来源沿用普通直接删除。确认只准备待删作品范围，不再读取保留原件、重哈希或重新比对图片。

新批次使用 `ARTWORK_BATCH_DELETE`，支持作品边界停止后续删除、单项失败继续、原范围重试。旧去重删除入口和执行器停用，历史记录保留只读。后台不再进入旧 generation drain 的固定三秒循环；检查算法、缓存和一万原件上限不变。

沿用[实施与验收记录](../dedup-shared-deletion-2026-10-31.md)：普通删除、选择、UI、任务权限/隐私、Worker 注册及 PostgreSQL/真实文件专项均已通过；包含失租约、事务回滚、正常 Worker 重启续跑和桌面实际混批删除。保留方及未选作品的文件完整性已核对。App/Worker 类型检查、必要 Worker 构建、定向 lint、文档与图示检查已完成，最终独立审查无待修阻塞项。

本机等价样本确认准备为普通入口 57.05 ms、去重入口 78.01 ms；执行约 1.08 秒，原图内容读取为零。执行期观测事务调用为 7 与 15（后者增加逐作品检查点），不是全请求精确 SQL 数。NAS 耗时留待上线后观测，不把本机数据当生产承诺。

本次无冲突合并未改变已验收源码，只做提交范围与文件一致性、迁移差异、文档链接、图示一致性及 whitespace 检查。不重复全量 lint/test/build、专项或浏览器回归。

发布检查：`pnpm docs:check` 通过 363 份 Markdown；`docs:diagrams:check` 在沙箱阻止 Chrome 启动后提升权限通过 34 份图源、23 段内嵌 Mermaid；`git diff --check` 通过，主应用路径无大写命中。

## NAS 交接与恢复依据

用户确认镜像生成后，按[标准发布](../../operations/deployment.md#标准发布)成对更新 App/Worker 至 `v0.55.9`。Compose 使用 `IMAGE_TAG=v0.55.9`，目标为 `dockernamehu/pixishelf:v0.55.9` 与 `dockernamehu/pixishelf-worker:v0.55.9`；GHCR 对应 `ghcr.io/namehu/` 同名镜像。本次不核验镜像可拉取状态。

升级前按[旧删除收口门槛](../../operations/runbooks/dedup-shared-deletion-upgrade.md)确认没有活动旧删除任务或未完成文件动作。新 Worker 会检查这项条件，不能靠删除历史记录绕过。此前已知卡住的 `41d05b53-f315-4e41-8cc7-71c01263a22d` 已由用户取消并复核零删除，本次未重复操作生产。

无新增迁移，不需要清除检查结果或有效缓存。按[备份恢复基线](../../operations/backup-and-recovery.md#发布前一致性检查点)保留更新前配套镜像及数据库、媒体同点检查点；代码回退不能恢复已删除文件。新批次开始后先完成或收口，再回退版本，旧 Worker 不能承接新批次类型。本次未执行 NAS 更新、备份或恢复。
