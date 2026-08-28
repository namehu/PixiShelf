---
status: current
scope: PixiShelf 单实例的备份集合、恢复目标、验证演练和灾难恢复边界
last-verified: 2026-08-28
sources:
  - build/docker-compose.deploy.yml
  - build/.env.example
  - packages/pixishelf-db/prisma/schema.prisma
  - docs/operations/deployment.md
  - docs/features/archive-intake.md
---

# PixiShelf 备份与恢复基线

本文回答“必须备份什么、什么才算一套可恢复备份，以及发生故障后按什么顺序恢复”。本文提供的是单用户、单实例、Docker Compose/NAS/Linux 部署的项目基线；具体 NAS 快照、异地复制和密钥托管方式由实例管理员选择并记录。

PixiShelf 的数据库和文件系统共同构成业务状态。只备份 PostgreSQL、只复制媒体目录，或只保留容器镜像，都不能称为完整备份。

## 恢复目标

当前内部运维目标是：

- 数据库和敏感配置每天至少备份一次；
- 原媒体与派生媒体的快照频率应使完整恢复点的 RPO 不超过 24 小时；
- 每次高风险发布、正式 migration、批量替换或大规模迁移前创建一致性检查点；
- 每季度至少完成一次隔离恢复演练；
- 最近一套已验证备份的目标 RTO 为半天；
- 始终保留至少一套最近且已经验证可以恢复的完整备份。

这些是项目内部目标，不是对外 SLA。媒体快照频率、数据规模、NAS 性能和异地副本可用性都会影响实际 RPO/RTO；未测量的恢复时间不能写成保证。

## 一套完整备份包含什么

| 数据类别   | 必需内容                                           | 说明                                                                             |
| ---------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| 业务数据库 | PostgreSQL custom-format dump                      | 包含领域数据、认证、队列、审计和 `_prisma_migrations`                            |
| 原媒体     | `PIXISHELF_DATA_PATH` 对应的同时间点快照           | 不可重新生成，是最高优先级数据                                                   |
| 派生媒体   | `DERIVED_MEDIA_HOST_PATH` 对应的同时间点快照       | 多数可重建，但数据库保存发布指针和生成状态                                       |
| Pixiv data | `PIXISHELF_PUBLIC_DATA_PATH` 对应的同时间点快照    | 作者图片、标签封面、作品元数据快照和同步报告；数据库保存最近路径、哈希与检查状态 |
| 部署配置   | `build/.env`、实际 Compose、反向代理配置           | 含密钥和真实路径，必须加密或严格限制权限                                         |
| 程序版本   | App、Worker 的 tag、image ID 或 digest             | 不依赖可变 `latest` 猜测恢复版本                                                 |
| 备份清单   | 时间、实例、文件名、SHA-256、快照 ID、操作者、原因 | 用于证明各部分属于同一恢复点                                                     |

数据库 dump、媒体快照和配置副本必须通过同一个备份清单关联。文件名相似或处于同一天，不足以证明它们来自同一时间点。

应用在替换、归档或迁移过程中产生的 staging、pending replace 和 recovery 文件是故障恢复机制的一部分，不是系统备份，不能替代上述完整备份集合。

## 备份类型

### 日常备份

日常备份用于控制普通硬件故障、误操作和数据库损坏的数据损失窗口：

1. 创建 PostgreSQL custom-format dump；
2. 记录 dump 的 SHA-256 和 migration 列表；
3. 由 NAS/文件系统创建原媒体和派生媒体快照；
4. 复制当前部署配置和镜像 digest；
5. 将数据库、三个媒体快照和配置登记成同一完整备份集合；
6. 将至少一个副本放到与生产存储故障域不同的位置。

在线数据库 dump 与普通目录复制并不天然处于同一事务时刻。只有在写入静默且底层存储能提供可协调、可验证的快照语义时，日常流程才能保持在线；否则日常备份也应使用下面的短暂停写窗口。无法证明数据库与媒体兼容的副本不能标记为完整或 `verified`。

### 发布前一致性检查点

正式 migration、归档架构切换、大批量替换、迁移、清理或其他可能同时修改数据库与文件的操作前，必须：

1. 停止 scheduler，禁止新计划任务物化；
2. 等待活动任务进入安全终态，或通过业务入口取消并完成恢复；
3. 停止 App 和通用 Worker；
4. 停止 Webhook 和所有外部写入脚本；
5. 确认没有进程继续写数据库、原媒体或派生媒体；
6. 在停写窗口内创建数据库 dump 和三个媒体快照；
7. 验证各备份可读后，才启动新版本。

`SCAN@v3 / AUDIT_APPLY` 是正式领域写操作。建立检查点前必须等待它完成，或通过任务控制入口完成取消收口；不能
只把 SystemJob 改成终态。数据库备份需要同时保留父核对、apply ScanRun、逐项结果、Source Reference、Source
Snapshot 和 inventory 状态，媒体快照则必须与这些发布结果属于同一恢复点。

从仓库根目录停止 Compose 写入者：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml stop scheduler
docker compose --env-file build/.env -f build/docker-compose.deploy.yml stop app worker
docker compose --env-file build/.env -f build/docker-compose.deploy.yml ps -a
```

`stop` 只覆盖 Compose 服务。Webhook 调用方、维护 shell 和 NAS 侧同步任务需要另行确认。

## 创建数据库备份

先在受限备份目录中生成 custom-format dump。`<backup-directory>` 必须替换为实例上的明确绝对路径，不要把备份写进 Git 仓库：

```bash
umask 077

docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T postgres sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > <backup-directory>/pixishelf.dump

sha256sum <backup-directory>/pixishelf.dump \
  > <backup-directory>/pixishelf.dump.sha256
```

同时导出 migration 历史，便于确认恢复版本：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T postgres sh -c \
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\''SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at;'\''' \
  > <backup-directory>/prisma-migrations.txt
```

通过 NAS 或文件系统工具为以下宿主机目录创建快照，并把真实快照 ID、创建时间和只读访问位置写入备份清单：

- `PIXISHELF_DATA_PATH`：原媒体；
- `DERIVED_MEDIA_HOST_PATH`：封面、章节图、代表帧和其他派生媒体。
- `PIXISHELF_PUBLIC_DATA_PATH`：Pixiv 作者图片、标签封面、作品元数据不可变快照和按任务保存的同步报告。

备份部署配置时至少保留实际 Compose、环境文件和反向代理配置。环境文件权限不得宽于仅管理员可读，例如：

```bash
chmod 600 <backup-directory>/config/env
```

不要在终端日志、工单、Git 或公开文档中输出环境文件内容。

## 备份验证

一套备份只有通过以下检查后，才能标记为 `verified`：

1. SHA-256 与清单一致；
2. `pg_restore --list` 可以读取 dump；
3. dump 可以恢复到隔离 PostgreSQL 数据库；
4. `_prisma_migrations` 没有失败或无法解释的记录；
5. 核心表数量和抽样关系合理；
6. 原媒体和派生媒体快照都能挂载或只读访问；
7. 抽样 Artwork 的数据库路径、媒体顺序、原文件和派生文件可以互相对应；
8. 恢复使用的 App/Worker 镜像 digest 和配置副本可取得。

先执行非恢复性检查：

```bash
sha256sum --check <backup-directory>/pixishelf.dump.sha256
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T postgres \
  pg_restore --list \
  < <backup-directory>/pixishelf.dump
```

隔离恢复示例使用一个专门的验证库。不要把示例数据库名替换成生产库，也不要在仍有 App 或 Worker 连接时执行恢复：

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T postgres sh -c \
  'createdb -U "$POSTGRES_USER" pixishelf_restore_verify'

docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T postgres sh -c \
  'exec pg_restore -v -U "$POSTGRES_USER" -d pixishelf_restore_verify --no-owner --no-privileges' \
  < <backup-directory>/pixishelf.dump

docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T postgres sh -c \
  'exec psql -U "$POSTGRES_USER" -d pixishelf_restore_verify -c '\''SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at;'\'''
```

随后使用只读 SQL 检查 Artwork、Image/Media、ArchiveRevision、SystemJob 和认证记录，并与媒体快照抽样对应。验证库的清理是独立的破坏性步骤，确认名称和连接目标后再执行，不复制到自动化生产脚本中。

## 灾难恢复顺序

只有服务重启、应用回滚和领域级修复都不能证明数据一致时，才进入完整恢复：

1. 停止 scheduler、App、通用 Worker 和所有外部写入者；
2. 保存事故现场：数据库 dump、容器日志、任务/事件清单和本次新增文件；
3. 确定恢复点，并核对数据库、原媒体、派生媒体、配置和镜像属于同一备份集合；
4. 在隔离环境完成一次数据库恢复和媒体抽样；
5. 评估恢复点之后将丢失的数据，并由实例管理员明确批准正式覆盖；
6. 使用 NAS/文件系统工具恢复三个媒体目录到目标快照；
7. 将数据库恢复到新建的空库或新实例；
8. 恢复匹配版本的配置和不可变镜像，不混用旧数据库与不兼容的新应用；
9. scheduler 保持关闭，两枚 Dispatcher 开关先保持 `false/false`；
10. 验证 migration、登录、目录查询、原图、视频、派生媒体、任务状态、两个 lane 与当前 capability inventory；
11. 再按[部署基线](./deployment.md)明确启动正确消费者和 scheduler。

正式数据库恢复禁止对仍有应用连接的生产库直接执行 `pg_restore --clean`。推荐恢复到新建空库并显式切换连接；数据库名、所有者、扩展和权限必须与目标版本要求一致。

执行 lane migration 后，旧 `archive-worker` 和任何不理解双 lane 的 Worker 都不能在新 schema 上启动。服务级回滚必须使用兼容双 lane schema 的 App/Worker；若必须回到旧消费者，只能恢复归档收件箱切换前同一检查点的数据库、原媒体、派生媒体、配置和镜像。旧[兼容回滚手册](../deployment/background-task-cutover-rollback.md)仅用于理解更早发布，不能照搬到当前 schema。

### 归档收件箱直切检查点

双 lane 迁移会把全局执行索引和租约边界替换为按 lane 约束，是旧 Worker 的明确回滚边界。切换检查点除完整备份集合外还必须记录：

- `archive:lane-cutover-audit` 的时间、退出码和脱敏报告；
- 迁移前后 `_prisma_migrations`、等待任务 type/version/status 和领域/媒体数量；
- App/Worker 新旧镜像 digest，以及确认旧消费者未运行的证据；
- 新 Worker READY、两个 lane、26 个 job type / 29 个 type-version 组合（`SCAN` v1/v2/v3、`ARCHIVE_IMPORT` v1/v2，其余 24 类 v1）和同
  lane 单执行证据；
- 收件 FIFO、resolver/writer 同时推进和 writer 不重叠的冒烟结果。

旧 `ArchivePreviewSession` 不要求在切换中转换；它由 30 天收件保留任务过期清理。收件历史清理不是备份策略，也不会删除 `ArchiveImport`、`SystemJob`、`Artwork`、`ArchiveRevision` 或媒体。

### Pixiv AI 派生标签历史回填

`PIXIV_AI_DERIVED_TAG_SYNC` 的只读预检不会修改数据库，可以在正常读流量下运行。正式回填会分批修改 `ArtworkTag.provenance`、补建或删除派生关系，属于大批量领域关系变更；执行前必须完成 PostgreSQL 一致性备份并记录任务预检结果。恢复单位是数据库检查点，不需要回滚媒体目录；不要用反向脚本猜测原 provenance。若正式任务中断，保持 App/Worker 版本不变后重试同一模式即可，任务的唯一约束和 provenance 条件会跳过已完成或被人工接管的关系。

### 历史归档默认标签补全

`ARCHIVE_DEFAULT_TAG_BACKFILL` 的弹窗预览只读；点击确认后会分批新增 `ArtworkTag` 关系，属于大批量领域关系变更。正式执行前必须完成 PostgreSQL 一致性备份并记录预览摘要、冻结的标签 ID、作品 ID 上界和任务 ID。该任务不修改媒体文件，恢复单位是数据库检查点，不要求为本次操作单独回滚媒体目录。取消会保留已经提交的关系；修正配置后重新运行会依靠唯一约束跳过已存在关系。若需要撤销已提交结果，必须恢复数据库检查点，不能按标签 ID 反向删除，因为同一 `MANUAL` 关系可能已被后续人工操作继续使用。

## 局部故障边界

### 只有派生媒体丢失

派生媒体通常可以从已验证的原媒体重新生成，但数据库保存已发布 generation、路径和任务状态。不要把空目录直接当成“已清理完成”，也不要从另一个时间点恢复派生目录。应先停止相关任务，枚举受影响发布指针，再通过受控重建或领域恢复流程修复。

### 只有数据库损坏

不能仅恢复数据库后继续使用较新的媒体目录。较新的归档、替换、迁移、Pixiv 图片或作品元数据快照可能与旧数据库无法对应；必须选择与 dump 配对的三个媒体快照，或逐项证明差异可通过领域恢复消除。

### 只有原媒体损坏

原媒体不可重新生成。立即停止写入和自动清理，保留故障存储状态，使用与数据库兼容的原媒体快照恢复；如需回退到更早快照，应同时评估数据库和派生媒体是否必须回到同一恢复点。

## 保留与安全

- 保留策略可以按容量采用每日、每周、每月分层，但不能在下一套备份验证成功前删除最后一套已验证备份；
- 发布前检查点至少保留到该版本稳定、回滚窗口关闭且下一套恢复演练通过；
- 数据库 dump、环境文件和配置可能包含账户、路径、Token 与私人媒体元数据，必须加密、限制访问并记录读取者；
- 至少一个备份副本应位于与生产主机/NAS 不同的故障域；同一磁盘上的目录副本不是灾难备份；
- 备份目录、dump、真实环境文件和恢复凭据不得提交到 Git；
- 定期验证备份目标容量、快照保留任务和异地复制告警，不能只验证“备份作业已启动”。

## 季度恢复演练记录

每次演练至少记录：

```text
演练日期：
备份集合 ID / 恢复点：
数据库 dump SHA-256：
原媒体快照 ID：
派生媒体快照 ID：
App / Worker image digest：
隔离恢复开始与完成时间：
检查的 migration 与核心表：
抽样媒体及结果：
实际 RPO / RTO：
失败、人工步骤和改进项：
负责人：
```

演练发现的命令错误、权限缺失、耗时超标和不一致必须进入 `TODO.md` 或对应事故记录，并在修复后重新验证。没有隔离恢复证据的备份仍应标记为“未验证”。
