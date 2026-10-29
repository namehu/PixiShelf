---
status: current
scope: 完整备份集合、一致性检查点、隔离验证与通用恢复
last-verified: 2026-10-22
sources:
  - build/docker-compose.deploy.yml
  - packages/pixishelf-db/prisma/schema.prisma
  - docs/operations/deployment.md
---

# 备份与恢复基线

PixiShelf 的数据库和文件系统共同构成业务状态。只备份数据库、只复制媒体或只保留镜像，都不是完整备份。本基线适用于单实例 Compose/NAS 部署；具体快照与异地复制工具由实例管理员记录。

## 恢复目标与完整集合

内部目标为完整恢复点 RPO 不超过 24 小时、最近已验证备份 RTO 半天，每季度至少完成一次隔离恢复演练。它们是运维目标，不是未测量即可保证的 SLA。高风险 migration、批量替换、迁移与清理前另建检查点，始终保留至少一套已验证的完整备份。

| 组成       | 必需内容                                                                          |
| ---------- | --------------------------------------------------------------------------------- |
| PostgreSQL | custom-format dump，包含认证、队列、领域/审计及 `_prisma_migrations`              |
| 原媒体     | `PIXISHELF_DATA_PATH` 同点快照，包含隐藏根身份、staging、替换 manifest 和恢复文件 |
| 派生媒体   | `DERIVED_MEDIA_HOST_PATH` 同点快照；数据库保存其发布指针和状态                    |
| Pixiv data | `PIXISHELF_PUBLIC_DATA_PATH` 同点快照；作者/标签图片、作品 metadata 和同步报告    |
| 配置       | 实际 Compose、环境文件、反向代理配置；加密或严格限制访问                          |
| 程序版本   | 配套 App/Worker 的 tag、image ID/digest 和可取得的镜像                            |
| 清单       | 集合 ID、时间、实例、原因、操作者、dump SHA-256、三个快照 ID、配置/镜像、验证结果 |

同一天或相似文件名不能证明同一恢复点。归档 staging generation（包括未确认 drain 的 orphan）、封存清单和已 rename 未发布目录必须与数据库同点保留；不能仅凭 lease 超时清理。staging、pending replace 和 recovery 目录是领域恢复机制，不能替代备份；它们也不能在“清理缓存”时随意删除。原媒体写入声明及 `.pixishelf-upload-recovery` manifest 也属于恢复集合；新协议的适用版本、状态与停止条件见[原媒体写入异常恢复](./runbooks/media-content-recovery.md)。

<a id="发布前一致性检查点"></a>

## 建立一致性检查点

1. 停止 scheduler、Webhook 调用方及 NAS 同步/维护脚本等外部触发。
2. 等待活动任务完成，或通过业务控制取消并完成恢复；不能只把 `SystemJob` 改成终态。
3. 停止 App、Worker 及全部外部写进程，确认数据库和三个文件根均静默。
4. 在停写窗口生成 dump、三个媒体快照和配置副本，记录旧/目标版本。
5. 完成备份可读与隔离恢复检查，才允许目标版本恢复写入。

```bash
docker compose --env-file build/.env -f build/docker-compose.deploy.yml stop scheduler
docker compose --env-file build/.env -f build/docker-compose.deploy.yml stop app worker
docker compose --env-file build/.env -f build/docker-compose.deploy.yml ps -a
```

`stop` 只覆盖该 Compose project，不能证明外部写入者已经停止。在线 dump 与普通目录复制不天然一致；只有能证明写入静默及底层快照可协调时，日常备份才可以保持服务在线，否则也使用短停写窗口。

## 创建与验证

以下为 Linux/NAS 模板，`<backup-directory>` 必须替换为仓库外明确的受限绝对目录。环境文件、dump 和真实路径不得进入 Git、工单或公开日志。

```bash
umask 077
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T postgres sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > <backup-directory>/pixishelf.dump
sha256sum <backup-directory>/pixishelf.dump > <backup-directory>/pixishelf.dump.sha256
```

同时保存 migration 列表、三个 NAS/文件系统快照 ID 与只读访问位置、实际配置和镜像 digest。配置副本应仅管理员可读。备份至少一个副本到不同故障域；同磁盘目录副本不是灾难备份。

```bash
sha256sum --check <backup-directory>/pixishelf.dump.sha256
docker compose --env-file build/.env -f build/docker-compose.deploy.yml exec -T postgres \
  pg_restore --list < <backup-directory>/pixishelf.dump
```

`pg_restore --list` 只证明可读取，不证明可恢复。标为 `verified` 前必须在明确的隔离 PostgreSQL 空库完成恢复，并核对：

- dump 校验值与清单一致，migration 无失败或无法解释的状态；
- 核心表计数、作品/媒体顺序、来源、归档版本、任务与认证关系合理；
- 三个媒体快照均可访问，抽样数据库指针、原件、派生文件及 Pixiv 快照相互匹配；
- 对应 App/Worker 镜像及配置可取得，隔离环境不会访问生产根或消费生产任务。

恢复命令模板只用于已经核对的隔离空库：

```bash
pg_restore --verbose --no-owner --no-privileges \
  --dbname='<isolated-empty-database-url>' <backup-directory>/pixishelf.dump
```

连接秘密通过受控环境或凭据文件注入，不把真实 URL 写入命令记录。验证库清理是独立步骤，不能把生产库名代入示例，也不能将清理直接拼进生产备份脚本。

## 灾难恢复顺序

![恢复决策](../diagrams/operations/recovery-decision.svg)

[图源](../diagrams/operations/recovery-decision.mmd)。决策依据是数据一致性和版本兼容性；重启成功不证明数据已经恢复。

1. 停止所有写入者，保全事故 dump、日志、任务/事件、manifest 和新增文件。
2. 选择完整备份集合，评估检查点之后会丢失的数据；先在隔离环境恢复并核对媒体。
3. 由实例管理员明确批准正式覆盖及数据损失后，将三个媒体根恢复到对应快照，数据库恢复到**新建空库/新实例**。
4. 恢复匹配配置和不可变 App/Worker 镜像；先保持 Worker、scheduler 和外部触发停止。
5. 核对 migration、数据库/文件一致性和兼容性；准备好消费后，按[标准发布](./deployment.md#标准发布)启动 Worker，验证 READY/capability，再开放 App 与调度。
6. 记录恢复点、实际损失、耗时、验证结果及未覆盖项，持续观察。

禁止对仍有应用连接的生产库直接执行 `pg_restore --clean`。旧数据库不得配不兼容新代码；归档下载 lane、双 lane、身份删列和任务退役二阶段之后也不得仅换旧镜像。旧 Dispatcher 开关不能阻止 Worker 消费。

## 局部故障与保留红线

| 情况             | 原则                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 仅派生媒体丢失   | 先停止相关任务、枚举已发布指针，再受控重建；不把空目录视为已清理，不拼接异时快照                                                              |
| 仅数据库损坏     | 较新媒体可能包含归档/替换/迁移结果；必须配套恢复或逐项证明可领域修复                                                                          |
| 原媒体损坏       | 原件不可重新生成；停写和自动清理，保全故障现场，选择与数据库兼容的快照                                                                        |
| 替换/上传中断    | 保留 `.replace-write-lock`、`.bak_session` 与 manifest；按[领域恢复](./runbooks/domain-recovery.md#上传与替换中断)核实，禁止按 mtime/超时盲清 |
| 纯数据库关系补全 | 仅在专用手册明确文件零变化且没有其他并发写入时，才可使用该操作的数据库检查点恢复                                                              |

2026-10-29 局部核验：部分归档补全后的退休标记、替代关系、媒体写入声明和删除检查点须随数据库保存。已退休旧修订的目录可以合法缺失，旧程序的“全部 revision 目录存在”假设不再成立；不能只换旧镜像或清除标记。成组回退与故障保全见[部分归档升级与恢复](./runbooks/archive-partial-coverage.md)。

具体删除、创作者合并、根标记、来源同步、阅读与批次恢复见[领域恢复手册](./runbooks/domain-recovery.md)。破坏性升级前的附加条件见[专项升级门禁](./runbooks/schema-and-capability-upgrades.md)。

- 下一套备份验证成功前不得删除最后一套已验证备份；发布检查点至少保留到版本稳定、回退窗口关闭及下一次恢复演练通过。
- dump、配置和媒体元数据可能含账户、路径与秘密，须限制访问、加密和记录读取者；备份副本应跨故障域。
- 定期检查容量、快照保留及异地复制告警，不能只记录“备份作业已启动”。

季度演练记录放在 `docs/records/operations/`：日期、环境/版本、备份集合及 SHA-256、三个快照 ID、开始/完成时间、migration/关系与媒体抽样、实际 RPO/RTO、失败与人工步骤、负责人。记录可引用受控证据位置，但不提交备份或秘密。没有隔离恢复证据仍标为“未验证”。
