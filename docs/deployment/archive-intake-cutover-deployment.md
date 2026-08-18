---
status: historical
scope: 归档收件箱、双执行 lane、中央归档维护与旧 archive-worker 退役的切换记录
last-verified: 2026-08-19
deployment-status: pending-production-evidence
current-source: ../operations/deployment.md
---

# 归档收件箱与双 lane 切换记录

本文登记一次性发布过程和恢复证据。代码实现与隔离环境验证不等于已经生产部署；在所有“待填”项目补齐前，`deployment-status` 保持 `pending-production-evidence`，不得引用本文声称生产切换已经完成。

当前功能与长期运维事实分别见[归档收件箱](../features/archive-intake.md)、[部署基线](../operations/deployment.md)和[备份与恢复](../operations/backup-and-recovery.md)。

## 发布身份

| 项目                     | 记录                         |
| ------------------------ | ---------------------------- |
| 发布负责人               | 待填                         |
| 目标环境/实例            | 待填                         |
| 代码 commit / tag        | 待填                         |
| App image ID / digest    | 待填                         |
| Worker image ID / digest | 待填                         |
| 停写开始时间             | 待填（含时区）               |
| migration 开始/完成时间  | 待填（含时区）               |
| 开放 App/claim 时间      | 待填（含时区）               |
| scheduler 恢复时间       | 待填（含时区）               |
| 回归完成时间             | 待填（含时区）               |
| 最终状态                 | 待填：完成 / 回滚 / 前向修复 |

## 变更边界

本次切换完成态包括：

- `/admin/archive/inbox` 持久收件、最多 100 行单次追加、1000 活动项、FIFO 解析和多选入队；
- `/admin/archive` 服务端分页/筛选、归档任务明细和当前页批量控制；
- 一个 `pixishelf-worker` 进程内的 `ARCHIVE_RESOLVE` 与 `BACKGROUND_WRITER`，各固定并发 1；
- 20 项 v1 capability 按 job type、definition version 与 lane 精确审计；
- `ARCHIVE_MAINTENANCE` 的 staging 清理、回收、恢复、状态对账和到期永久清理；
- 每日 `02:05` 归档维护对账和每日 `02:15`、30 天收件历史保留清理；
- 旧 `archive-worker` workspace、镜像、Compose、CI 和独立循环退出当前运行边界。

精确 migration、表、字段和约束以 Prisma Schema 与 migration 文件为准。

## 停写与专用审计

执行前确认：

- [ ] scheduler 已停止，计划任务不再物化；
- [ ] App、Worker、Webhook、scanner、维护脚本和 NAS 侧写入者已停止；
- [ ] `pnpm --filter @pixishelf/next archive:lane-cutover-audit` 退出码为 `0`；
- [ ] 没有 `RUNNING/PAUSING/CANCELLING` 的 SystemJob；
- [ ] 没有未过期的 `global/background-worker` lease 或 90 秒内新鲜旧 Worker；
- [ ] 没有 `RUNNING/CANCELLING` 的 ArchiveImport；
- [ ] 所有保留的 `PENDING/PAUSED/RETRY_WAIT` 都是新 Worker 支持的 v1 type。

审计证据：

| 项目              | 记录               |
| ----------------- | ------------------ |
| 运行时间          | 待填               |
| 退出码            | 待填               |
| 报告 SHA-256/路径 | 待填（不得含秘密） |
| 阻断项处置        | 待填或“无”         |

## 一致性检查点

数据库 dump、两个媒体快照、配置和镜像必须属于同一停写窗口：

| 组成                          | ID / 路径 / SHA-256 / 时间 | 可读/恢复验证 |
| ----------------------------- | -------------------------- | ------------- |
| PostgreSQL custom-format dump | 待填                       | 待填          |
| `_prisma_migrations` 清单     | 待填                       | 待填          |
| 原媒体快照                    | 待填                       | 待填          |
| 派生媒体快照                  | 待填                       | 待填          |
| Compose / 环境配置副本        | 待填                       | 待填          |
| 旧 App/Worker 镜像            | 待填                       | 待填          |
| 新 App/Worker 镜像            | 待填                       | 待填          |

环境文件、Token、数据库凭据和私人 URL 不得复制到本文或普通日志。

## 非空数据库 migration 演练

2026-08-19 已在一次性 PostgreSQL 15 容器中完成合成非空 fixture 演练。演练没有连接或修改开发数据库；结束后容器和临时文件均已删除。

| 项目               | 本地合成演练证据                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 迁移范围           | 先部署前 52 个 migration 形成旧 schema，再增量部署至 56 个；旧链耗时 1.56 秒，四个增量 migration 耗时 1.64 秒。                                                                                        |
| 等待任务 fixture   | 两条 v1 等待任务：`SCAN/PENDING` 与 `ARCHIVE_IMPORT/PAUSED`；同时包含父任务关系。                                                                                                                      |
| 归档领域 fixture   | `ArchiveImport`、`URL_ARCHIVE` Artwork、ExternalRef、ArchiveRevision、Image 各一条；另含一条已陈旧的 Worker presence 和一条已过期的 `global/background-worker` lease。                                 |
| 迁移前审计         | 专用 audit 返回 15 项检查、blocker 总数 0。                                                                                                                                                            |
| 数据保持           | 两条等待任务的 ID、type、status、definitionVersion、payload、parent 和外键均保持；ArchiveImport、Artwork、ExternalRef、Revision、Image 的 ID、关系与迁移前后计数保持，没有领域或媒体记录被改写或删除。 |
| lane 回填与约束    | 旧任务全部回填为 `BACKGROUND_WRITER`；按 lane 的执行态唯一索引、type/lane CHECK、收件新表和相关索引均存在。                                                                                            |
| lease 清理         | 已过期旧全局 lease 从一条清理为 0 条。                                                                                                                                                                 |
| 双 lane 数据库围栏 | `ARCHIVE_RESOLVE` 与 `BACKGROUND_WRITER` 各存在一条 RUNNING 可以成立；第二条 writer RUNNING 被唯一索引拒绝，错误 lane 被 type/lane CHECK 拒绝。                                                        |
| migration guard    | 存在 RUNNING 任务时 lane migration 以 SQLSTATE `55000` 失败并完整回滚；migration 仍为 52 个，未残留部分 enum/type/DDL。                                                                                |
| 容量、WAL 与锁     | 数据库从 11,853,159 bytes 增长到 12,279,143 bytes；增量 WAL 约 295 kB；观察到 0 conflict、0 deadlock、0 未授予锁。                                                                                     |
| 最终状态           | 56 个 migration 全部同步；迁移后 audit blocker 总数仍为 0。                                                                                                                                            |

这组结果证明合成历史数据上的 guard 原子性、数据保持和双 lane 数据库围栏，不替代生产脱敏副本演练，也不替代正式停写窗口中的数据库 dump、原媒体、派生媒体、配置和镜像一致性检查点。生产副本的真实数据规模、锁/WAL、migration 时间和恢复证据仍为待填。

## 暗启动与切换证据

迁移由一次性新 Web 镜像执行；迁移成功后不得启动不理解双 lane 的旧消费者。保持 `false/false` 暗启动新 Worker，并记录：

- [ ] `healthcheck.cjs --mode=ready` 通过且两个 lane READY；
- [ ] `capability-audit.cjs` 精确报告 20 项 v1 和正确 lane；
- [ ] 只有一个当前 Worker 服务/实例；
- [ ] 新 Compose 在停写后使用 `--remove-orphans`，且按 `com.docker.compose.service=archive-worker` 查询所有容器的结果为空；
- [ ] 旧全局 lease 不存在，两个 lane lease/claim 正常；
- [ ] App 在 Dispatcher 关闭时完成登录、目录和媒体只读抽样；
- [ ] 同时切换为 `true/true` 后 App 与 Worker 重建成功；
- [ ] scheduler 只在功能冒烟完成后恢复。

命令输出、容器 ID、Worker ID、旧消费者为零的容器标签查询结果和时间：待填。专用数据库 audit 无法识别空闲的旧容器，因此这项容器证据不能由 audit blocker 为零替代。

## 功能冒烟

| 验收项                                                       | 结果/证据 |
| ------------------------------------------------------------ | --------- |
| 持续添加 URL 不等待上一条解析                                | 待填      |
| 刷新/Worker 重启后 FIFO、attempt 和 pause 保持               | 待填      |
| resolver 与 writer 各运行一项                                | 待填      |
| 两项 writer 永不同时运行                                     | 待填      |
| 已就绪项目在其余解析期间批量入队                             | 待填      |
| 部分失败不阻断其余项目，重复 URL/身份/命令不创建重复活动任务 | 待填      |
| 切换前等待任务由新 Worker 继续                               | 待填      |
| 归档删除/恢复/到期永久清理走中央维护且路径不越界             | 待填      |
| `02:05` 对账物化按目标子任务                                 | 待填      |
| `02:15` 保留清理只删除超过 30 天的收件/批量/预览历史         | 待填      |
| 日志、任务、事件和批量结果不泄露 URL/token/path 敏感段       | 待填      |

## 回滚与事故处置

切换前可以停止并修复审计阻断项。lane migration 应用后：

1. 先停止 scheduler，把两枚开关切为 `false/false`，停止 App/Worker claim 并保存现场；
2. 可使用兼容双 lane schema 与 20 项 capability 的 App/Worker 回退或前向修复；
3. 旧 `archive-worker` 不能在新 schema 上启动；
4. 若必须回到旧消费者，只能恢复本记录登记的切换前完整检查点，包括数据库、原媒体、派生媒体、配置和旧镜像；
5. 不执行破坏性 reverse migration，不只恢复数据库或只恢复媒体。

如发生回滚，记录触发条件、受影响 job/item/artwork、保存的现场、批准人、恢复点、数据损失窗口和最终验证：待填。
