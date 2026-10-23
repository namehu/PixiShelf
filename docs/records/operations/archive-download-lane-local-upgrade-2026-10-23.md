---
status: verification-record
date: 2026-10-23
scope: 本地开发环境的归档下载独立通道升级与服务就绪检查
deployment-status: local-ready-browser-acceptance-pending
current: ../../operations/deployment.md
---

# 归档下载通道本地升级

2026-10-23 已按用户授权升级本机环境。数据库迁移、Worker 重建和宿主机 Web 启动完成；浏览器业务验收由用户执行。本文不代表远端生产环境已升级。实现与测试证据见[实施验证](../archive-download-lane-2026-10-23.md)。

## 环境与版本

- 拓扑：开发 Compose 的 PostgreSQL 15、ImgProxy、单实例 Worker，以及宿主机 `packages/pixishelf` 中的 `pnpm dev`，Web 端口为 5430。
- 源码基点为 `c3df56bea1e96bd790081adeb7fe6f4ca86c4a86`，包含本次尚未提交的工作区改动；完整工作区源文件归档已随检查点保存，不能只用该 commit 标识本次实现。
- 旧 Worker 镜像：`sha256:4900a1442e5243b4bbcbe83581dd9e4ed5a168c93ac5e1973126565aef2d77d9`。
- 新 Worker 镜像：`sha256:520fea9a5523a20e394fb0b3097af85c831b5d106a24b43843ac3696ea9a0e0d`。
- 升级前 Web 未运行，scheduler 未启用；旧 Worker 停止后确认容器进程 PID 为 0、退出码为 0，活动任务和其他业务数据库连接均为 0。

## 恢复依据

停写检查点标识为 `download-lane-20261023-161028`，保存在管理员私有备份目录。集合包括数据库 custom dump、原媒体/派生媒体/Pixiv data 三个完整目录归档（包含隐藏文件）、实际配置、源码归档、迁移列表、SHA-256 清单和旧镜像恢复标签。配置与备份文件仅当前用户可读写；真实路径及配置正文未提交仓库。

数据库备份已实际恢复到独立 PostgreSQL 空库，未挂载业务目录或启动消费者。84 张表的行数均与源库一致；99 条成功迁移、12 条已回滚历史记录、0 条未解决迁移。三个媒体归档可读取，原媒体与 Pixiv data 文件内容均与停写源目录核对一致；40 个数据库图片指针全部对应备份中的原件，派生媒体根当时没有业务文件。隔离恢复容器在检查后已删除。

这是同机升级检查点，尚未建立异地副本，不将其记为跨故障域灾难恢复备份。原始依据保存在该集合的 `manifest.json`、`restore-validation.json`、`migration-validation.json`、`upgrade-result.json` 及构建日志中。旧镜像标签为 `pixishelf-worker:before-download-lane-20261023-161028`；迁移后不能仅换回旧镜像，恢复边界仍遵循[备份与恢复](../../operations/backup-and-recovery.md)。

## 执行与结果

Docker 虚拟磁盘空间不足时，仅回收超过 24 小时的未使用构建缓存，释放约 10 GB；没有删除既有容器、镜像或数据卷。标准 Worker 镜像构建首次因 Docker Hub 连接超时失败；随后通过宿主机现有代理取得官方 Dockerfile/Node 镜像，核验各层 SHA-256 后导入本地，再使用原项目 Dockerfile 完成构建。项目依赖、锁文件和 Docker 网络配置均未因此修改。

先完成 `db:generate` 和 Worker 镜像构建，再执行 `db:deploy`，仅新增以下两条迁移：

- `20261023000000_archive_download_lane_enum`
- `20261023001000_archive_download_lane`

`db:status` 确认全部 101 条迁移同步，无未解决迁移。迁移后原有表的行数保持不变，仅 `_prisma_migrations` 增加两条记录；本机当时没有旧归档导入记录，因此关联回填行数为 0。未执行 `db:push`，未搬移媒体。

新 Worker 于 16:22（Asia/Shanghai）启动，容器为 healthy，`healthcheck.cjs --mode=ready` 通过；`/readyz` 明确返回 `ARCHIVE_RESOLVE`、`ARCHIVE_DOWNLOAD`、`BACKGROUND_WRITER` 均为 READY。`capability-audit.cjs` 确认仅有一个当前 READY Worker，37 种任务、45 个定义版本及 lane 与本版完整清单一致。

宿主机 Web 于 16:23 启动，数据库连接成功，`GET /login?entry=direct` 返回 HTTP 200。Web 以独立后台进程运行，启动 PID 和日志位置记录在私有 `upgrade-result.json` 中。scheduler 保持未启用，数据库和 ImgProxy 保留原服务。

## 验收边界

本次仅检查迁移、数据保持、恢复可用性、服务就绪及 HTTP 可达性，没有执行浏览器验证，也没有为验收创建实际下载任务。下载期间其他任务并行、归档发布和用户操作的浏览器验收仍由用户完成。
