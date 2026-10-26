---
status: historical
scope: F02 第一批合入主目录及开发 Worker 无迁移升级
last-verified: 2026-10-26
sources:
  - docs/records/artwork-deduplication-cache-batch-f02-2026-10-26.md
  - build/docker-compose.dev.yml
  - docs/operations/backup-and-recovery.md
---

# F02 第一批本地升级

主目录 main 在 `a0ae9bce` 且工作区干净，用户授权合并并重建 Worker。执行 `git merge --ff-only codex/dedup-cache-batching` 至 `4ea9de96`，未覆盖主线文件或暂存区；沿用该提交已有定向验证，不重复 App 全量验证。

本批仅优化 Executor 缓存读写，没有 Schema、任务协议或删除语义变化。开发数据库保持 122 个已应用 migration，没有执行迁移、db:push、数据恢复或媒体写入。只读核对升级前后作品 18、媒体 518、单图标记 2，三类记录完整字段摘要一致；升级前无活动任务。用户 App PID 68956 在 5430 运行，未停止或重启；数据库与 ImgProxy 容器未重建。

保留旧 Worker 镜像 `sha256:e75b1d2afa2539c59cdb6e356a4a0a70fc852d693bec85735d56b6ae48413039`，标签 `pixishelf-worker:before-f02-cache-20261026`。本次为兼容的程序替换，可使用旧镜像恢复 Worker；之前已验证的完整开发备份继续保留。升级读数只用于证明本次记录未变，不冒充新的完整备份集合。

执行 `docker compose --env-file build/.env -f build/docker-compose.dev.yml build worker` 和 `up -d --no-build --no-deps worker`。新镜像 `sha256:7f960a88c0bc19376cb7b28f0cacc6c9f16fbd72c41de14c7ab9ace18d38cc2c`；容器 running/healthy，ready healthcheck 与 capability audit 通过：1 READY Worker、39 类任务／54 个版本。镜像必要构建包含既有三项 CJS/import.meta 警告；没有全量应用测试或构建。

只读证据位于受限目录 `/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/` 下 `f02-cache-dev-upgrade-before.json` 和 `f02-cache-dev-upgrade-after.json`。本记录只证明本地开发升级，不代表 NAS 发布；F02 第二批从独立 `codex/dedup-relation-cache` 分支另行实施，不自动部署其未验收代码。
