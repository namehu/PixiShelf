---
status: historical
scope: F01 合入主目录、开发库保留数据迁移、Worker 重建启动及桌面支持范围调整
last-verified: 2026-10-26
sources:
  - docs/records/artwork-deduplication-partial-overlap-f01-2026-10-26.md
  - docs/operations/runbooks/artwork-deduplication.md
  - docs/operations/backup-and-recovery.md
  - build/docker-compose.dev.yml
---

# F01 本地开发升级

用户授权将 F01 合回主目录，保留主线改动和现有数据，迁移开发库并重建启动 Worker；App 由用户自行 F5 启动，不重跑全量验证。

## 合并与终端范围

主目录 `/Users/namehu/mm_code/PixiShelf` 的 `main` 干净，仍为 F01 基线 `2b184aca`。使用 `git merge --ff-only codex/dedup-partial-overlap` 快进至 `59ac7f0d`，没有重写提交、覆盖工作区或解决冲突。该提交已完成定向测试及独立审查，沿用既有验收证据，本轮未重新跑 App lint/test/build。

用户决定后续不再为去重文件对照与删除维护移动端专用适配或手机验收门槛。支持边界已更新到[当前功能规格](../../features/artwork-deduplication.md)；保留已有响应式兼容，不在此次升级删除页面分支或禁用手机入口。历史手机验收记录仍表示当时实际结果。

## 检查点与数据保留

升级前 App 的 5430 端口空闲，开发库没有活动任务，scheduler 未运行。停止旧开发 Worker 后建立受限检查点：

`/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-f01-dev-upgrade-20261026-141033-mpn989f_`

保存 custom-format dump、原媒体/派生媒体/Pixiv data/本地归档根副本、实际配置和旧 Worker 镜像标签。dump 为 784,365 字节，其 SHA-256、源文件逐项 SHA、配置和日志仅存私有检查点，不进入 Git。

数据库 dump 在新建临时空库实际恢复，113 张表的数量和行摘要与停写快照一致，随后仅移除该临时验证库。原媒体 249 文件、Pixiv data 98 文件、本地归档根 1 文件、派生媒体 0 文件；源目录复制前后与副本的长度/SHA-256 均一致。此检查点属于本机开发恢复依据，不代表异机灾备演练。

正式执行 `db:generate`、`db:deploy`、`db:status`，仅应用 `20261026000100_artwork_dedup_partial`：完成迁移 121→122，失败迁移 0，原有 12 条已回滚历史保留，历史总行数 133→134。没有使用 `db:push` 或重建开发数据库。

启动新 Worker 前按原字段投影比对 112 张既有业务表，数量与行摘要全部一致：作品 15→15、媒体 218→218、单图标记 2→2。未触发扫描、内容重算或删除。

## Worker 与启动交接

旧镜像 `sha256:6a5e8c68605b170c427439b4c70c15998747b829023f7b9b77ae795075144ce7` 另存标签 `pixishelf-worker:before-f01-20261026-141043`。

仅构建 Worker 及必要依赖，随后 `up -d --no-build --no-deps worker`。新镜像为 `sha256:e75b1d2afa2539c59cdb6e356a4a0a70fc852d693bec85735d56b6ae48413039`，容器 running/healthy；READY 检查和能力审计通过：1 个 READY Worker、39 类任务/54 个版本，扫描 v1–v4、维护 v1–v5 及三个执行通道完整。数据库、ImgProxy 和隔离测试环境未重建；App 未启动，5430 保持空闲，scheduler 未启用。

文档检查通过：276 份 Markdown、33 个图源和 23 处内嵌 Mermaid；主应用路径大小写检查通过。没有重复功能测试、浏览器回归或全量 App 验证。

用户在主目录使用原 VS Code F5 配置即可。若需回退，先停写并按检查点恢复匹配的数据和程序；存在新协议操作时不能仅换旧 Worker 镜像。后续 F02–F04 未开始，本轮不推送或发布线上版本。
