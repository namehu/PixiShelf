---
status: historical
scope: F02 第三批合入主目录、开发库保留数据迁移与 Worker 重建启动
last-verified: 2026-10-27
sources:
  - docs/records/artwork-deduplication-shared-visual-cache-f02-2026-10-27.md
  - docs/operations/backup-and-recovery.md
  - docs/operations/runbooks/artwork-deduplication.md
  - build/docker-compose.dev.yml
---

# F02 相同内容缓存本地升级

用户授权合回主目录、保留开发数据并重建启动 Worker；App 由用户 F5 启动。本轮沿用已完成的专项、独立审查和桌面验收，不重复全量 App lint/test/build。

## 基线与合并

主目录 `/Users/namehu/mm_code/PixiShelf` 的 `main` 为 `3e6da00d`，工作区干净；与 `codex/dedup-shared-visual-cache` 没有分叉。通过 `git merge --ff-only codex/dedup-shared-visual-cache` 快进至 `3b5901cd`，保留主线全部历史，没有重置、覆盖未提交文件或改动环境配置。

## 备份与迁移

升级前 App5430 无监听，Compose scheduler 未启用，开发库无活动任务。停止旧 Worker 后保存检查点：

`/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-shared-dev-upgrade-20261027-115315-l_fz7oe0`

检查点含数据库 custom-format dump、受限配置副本、原媒体589文件／91,200,551字节、Pixiv data98文件／37,025,109字节、本地归档1文件／24,441字节，以及派生媒体空目录。逐文件长度、SHA和符号链接目标与副本核对一致。dump在本次新建的临时空库恢复，112张业务表的数量及完整行摘要一致，迁移数量一致；随后只删除该临时恢复库。完整检查点保留在仓库外，不取代异地备份或生产恢复演练。

确认主目录 App 与迁移目标都是 `127.0.0.1:5432/pixishelf` 后，执行 `db:generate`、`db:deploy`、`db:status`。正式迁移123→124，只新增 `20261027000100_artwork_dedup_shared_visual_cache`，失败迁移0，没有使用 `db:push`。

迁移后、Worker恢复写入前，按升级前字段投影核对112张既有业务表，行数和摘要全部一致。现有22部作品、558张图片、2条MediaMark和360条媒体视觉缓存保留；旧视觉缓存的新增SHA／大小均为null，没有回填或扫描媒体。

## Worker 与交付

旧镜像 `sha256:db766b758a1e3a20333e3e3713728cc65eaa23284bcdd05ff6caa7249139f2f8` 保留为 `pixishelf-worker:before-f02-shared-20261027-115315`。

执行一次 `docker compose --env-file build/.env -f build/docker-compose.dev.yml build worker`，新镜像为 `sha256:c060ca764d45bf9d6dcc6dd5f2595930f318763597a46a9c71038454a962b84b`。随后 `up -d --no-build --no-deps --wait worker`，容器running／healthy；READY健康检查与完整capability审计通过：1个READY Worker，39类任务／54个版本。数据库与ImgProxy没有重建，原环境配置及媒体挂载保持不变。

启动后再次只读核对检查点中的全部普通文件，589个原媒体根文件、98个Pixiv data文件和1个本地归档文件的清单、长度与SHA均未变。App5430仍无监听。运行状态与镜像证据保存在检查点的 `upgrade-after.json`。

App由用户在主目录F5启动；本轮不启动App、不新增或删除测试作品、不推送或发布线上。回归入口沿用 `http://localhost:5430/admin/duplicates?artistId=21&entry=direct`。这是缓存优化，页面流程保持原样；旧缓存仍能按媒体身份使用，不需要为迁移强制完整检查。

私有复现与审计入口为 `/private/tmp/pixishelf-f02-shared-upgrade.py`，检查点路径记录在 `/private/tmp/pixishelf-f02-shared-upgrade-path`。检查点中的 `before-tables.json`、`restored-tables.json`、`after-migration-tables.json`、迁移日志及构建日志可复核本次结果。恢复按[备份基线](../../operations/backup-and-recovery.md)执行，不对运行中的开发库直接覆盖恢复。
