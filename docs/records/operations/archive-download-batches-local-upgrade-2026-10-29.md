---
status: historical
scope: 下载批量保存版本的本地开发环境启用
last-verified: 2026-10-29
sources:
  - README.md
  - build/docker-compose.dev.yml
  - docs/records/features/archive-download-batches-2026-10-29.md
---

# 下载批量保存版本：本地环境启用

2026-10-29 按用户要求更新本机开发环境，使用当时工作区代码构建，尚未提交对应发布版本。没有操作飞牛实例。

## 配置与迁移

- App 与 Worker 确认连接同一个本机 PostgreSQL，连接信息仅比较匹配结果，不记录凭据。
- 修正 App 的 `ARCHIVE_STORAGE_PATH`，使其与 `SCAN_PATH` 及 Worker 原媒体挂载指向同一目录；没有移动或删除媒体。
- 更新前无 RUNNING、PAUSING 或 CANCELLING 任务；停止旧 Worker 和 Next.js 后保存本地数据库 custom-format dump、环境文件副本和旧镜像身份。备份在仓库外受限临时目录，位置保存在本机操作记录中，没有提交数据库或配置文件。
- dump 通过 `pg_restore --list` 可读性检查。此次没有完整恢复演练或媒体快照，不将其标为完整备份集合；恢复原则仍以[备份与恢复](../../operations/backup-and-recovery.md)为准。
- 下载改动本身不含迁移；本地环境原有积压的三个去重迁移经检查后通过 `db:generate`、`db:deploy` 补齐：`20261028000100_artwork_dedup_visual_rounds`、`20261029000100_artwork_dedup_mixed_visual`、`20261029000200_artwork_dedup_quick_confirmation`。`db:status` 确认 129 个迁移已同步；未使用 `db:push`。

## 启用与验证

- 从当前工作区重新构建并启动本地 Compose Worker。镜像 ID 为 `sha256:90a8c11fcbe04aaa8a73ff62078623e9da12a7280136918f28fe7a24bcad7187`。
- `node dist/healthcheck.cjs --mode=ready` 成功；`node dist/capability-audit.cjs` 确认 1 个 READY Worker、39 个任务类型及 58 个版本，包含下载和发布能力。
- 宿主机 `pnpm dev` 已重新启动，端口 5430；ImgProxy 健康接口返回 HTTP 200。
- 真实浏览器访问 `/admin/archive?entry=direct`，正常跳转并显示登录页。该浏览器没有登录会话，因此此次只验证页面可达，没有把它记作暂停／取消／下载的浏览器端到端验收。

暂停、取消与重启的隔离执行器验证见[批量下载测试记录](../features/archive-download-batches-2026-10-29.md)。

## 用户人工回归与结果核对

用户随后在本地浏览器完成 A、B 两个作品的操作，并明确确认本轮回归通过。以下时间为 Asia/Shanghai；核对过程只读查询本地数据库及文件。

- A：正常下载、暂停和继续后发布为本地作品 39，34/34 张成功、失败 0。事件记录为 15:20:29 暂停、15:21:45 继续；34 张正式文件均存在，文件大小与 SHA-256 全部匹配数据库结果。
- 正常重启：用户确认在 A 下载期间发起 Worker 重启。持久记录显示 15:22:16 下载收尾，15:22:17 Worker 启动，15:22:19 发布完成，确认正常重启与后续入库衔接通过。该人工样本没有单独观察到未完成图片跨进程续传；这一分支由前述隔离数据库测试覆盖，不将人工结果写成强制中断或断电验收。
- B：15:25:33 请求取消，15:25:37 完成取消；持久状态为 CANCELLED，23 张完成、21 张 PENDING、0 张 DOWNLOADING、失败 0。没有发布任务或发布版本，取消后图片记录没有继续变化；暂存保留期限属于正常保留规则。
- 两项归档执行均无 ERROR 级事件。本轮结论为本地回归通过，不代表飞牛已部署或生产吞吐、数据库负载已验收。
