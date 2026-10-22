---
status: historical
scope: 2026-10-06 归档继续后 Worker 退出现场与恢复建议
last-verified: 2026-10-06
sources:
  - docs/operations/backup-and-recovery.md
---

# 归档继续后 Worker 退出事件

证据类型：原运维文档保存的生产事件。镜像版本和实际恢复结果未登记；本轮未连接生产。

### 2026-10-06 归档继续后 Worker 重启的恢复依据

生产事件证据：任务 `b5b47d83-5d8c-4efc-bcf4-a5b73fdf6fe5` 最初因媒体节点 HTTP 403 暂停；北京时间
2026-10-06 22:20:26 和 22:21:27，第 2/3 次执行均在开始后约 0.2 秒出现
`worker.job_domain_finalization_failed`（归档终止状态已变化），随后 `worker.dispatch_fatal` 和进程退出。
最终 `WORKER_LEASE_EXPIRED` 是退出后的恢复结果，不能取代最初的业务错误作为根因。

本次代码修复无数据库迁移，不删除暂存文件、不手动修改生产状态。按既有发布备份要求保留数据库/媒体检查点与旧镜像，
成对更新 App/Worker 后，从后台任务详情对失败任务执行一次“重试”：新任务应绑定原归档、保留已完成图片并按原质量下载。
核对新任务 ID、完成数、Worker 状态与新诊断。原任务作为审计历史保留；不要删除暂存或重建归档来恢复此问题。
恢复后仍遇媒体 403 时按新诊断排查来源访问；遇 509 则等待额度恢复。这里描述恢复流程，不宣称生产已经部署或恢复成功。

该实例部署目录为 `/vol1/1001/docker-compose/pixivShelf`，已确认 Worker 容器名为 `pixivshelf-worker-1`。
读取现场日志使用 `sudo docker logs --timestamps pixivshelf-worker-1`，不假定 NAS 存在仓库的 deploy Compose 文件。
容器名仅为本次现场记录，后续实例应先通过 `sudo docker ps -a` 核对。
