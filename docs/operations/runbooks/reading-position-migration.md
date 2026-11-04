---
status: current
scope: 从逐媒体集合迁移到单行阅读位置、验收和独立封存清理
last-verified: 2026-11-04
sources:
  - packages/pixishelf-db/prisma/migrations/20261104010000_reading_position_progress/migration.sql
  - packages/pixishelf-db/maintenance/reading-position-v1/
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-db/prisma/__tests__/reading-position-migration.postgres.test.ts
---

# 阅读位置迁移与封存清理

适用源状态：数据库已成功执行 `20261102120000_archive_download_preparation` 及之前的正式迁移，仍在应用 schema 中使用 `artwork_reading_summaries` 与 `artwork_read_media`，尚未执行位置迁移。目标为 `20261104010000_reading_position_progress` 与配套 Web App、Worker。独立 Android 客户端已按用户要求暂停，不阻塞 Web 发布；旧客户端暂停使用，后续若恢复必须升级到当前位置契约，服务端不提供旧阅读协议兼容分支。全新空库直接按正常全链 `db:deploy` 安装；本手册的旧数据核对针对升级实例。

**停止条件**：未能停止全部写入者、缺少同点完整备份或隔离恢复依据、未知/失败 migration、源 schema 不符、预检出现无法解释的依赖或计数、迁移/核验失败，均保持停写并先定位。恢复单位是数据库、原媒体、派生媒体、Pixiv data、配置和配套程序的共同检查点；封存两表不能单独恢复旧应用。完整备份规则见[备份与恢复](../backup-and-recovery.md)。

本手册交付 SQL 与操作步骤，不表示生产执行授权已被使用。此次执行及生产验收状态见[发布记录](../../records/features/artwork-reading-position-2026-11-04.md)。

## 两阶段材料

| 阶段           | 文件                                                                                                                          | 作用                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 发布前         | [preflight.sql](../../../packages/pixishelf-db/maintenance/reading-position-v1/preflight.sql)                                 | 只读检查源计数、快照差异、旧完成、仅已读行及数据库端依赖                                           |
| phase 1        | [正式 migration.sql](../../../packages/pixishelf-db/prisma/migrations/20261104010000_reading_position_progress/migration.sql) | 一个显式事务中建表、回填、精确断言、解除旧外键并封存，交由 Prisma 记录 history                     |
| 发布后停写窗口 | [postflight.sql](../../../packages/pixishelf-db/maintenance/reading-position-v1/postflight.sql)                               | 只读重建逻辑映射，逐账户/作品比较完整预期与实际，核对逻辑缓存及运行时数据库依赖                    |
| 后续清理前     | [cleanup-preflight.sql](../../../packages/pixishelf-db/maintenance/reading-position-v1/cleanup-preflight.sql)                 | 只读确认 phase 1 history、封存范围及数据库依赖，不比较已合法变化的新阅读状态                       |
| phase 2        | [phase2-cleanup.sql](../../../packages/pixishelf-db/maintenance/reading-position-v1/phase2-cleanup.sql)                       | 验收并至少观察 7 天后，原样作为另一条正式 migration 发布；仅删除两表和空 schema，全部使用 RESTRICT |

首次发布的 `prisma/migrations` 仅包含 phase 1。清理 SQL 留在 maintenance，不能随首次发布自动部署，也不由启动代码或后台任务自动执行。没有 TS 升级框架、旧表 fallback 或双写。

## 回填规则

逻辑顺序与共享 `groupLogicalMedia` 相同：先按 Image 的 `sortOrder,id` 排列，以区分大小写的文件名 stem 将尾缀 APNG 归入同 stem 的第一个视频，目录不同不妨碍分组。视频类型或受支持扩展均可识别，扩展识别忽略查询串，但 stem 与 APNG 检测保留其原规则。逻辑分母不是原 Image 行数；迁移为所有 Artwork 写入 `logicalMediaCount`，含没有阅读记录或没有媒体的作品。

账户/作品键取旧摘要和旧已读行的并集。摘要原先满足 `totalCount > 0 && seenCount * 100 >= totalCount * 90` 时，迁移明确保留其已完成状态，即使快照因普通新增而陈旧；preflight 只报告差异，不取消这一用户选择。其他记录按当前逻辑序列中旧已读行的最大索引形成前缀，最大项为当前末项也完成。没有有效旧已读项则没有最远锚点；有效旧最后媒体映射到当前逻辑代表，已删/无效最后项保持空。

已有摘要原样保留访问次数、真实阅读/活动时间、创建时间和更新时间，`stateVersion` 加一。只有已读行也建立新行，以旧首次/末次已读时间保留记录创建/更新时间，访问次数为零、真实阅读/活动时间与最后位置为空；不把手工已读解释为真实观看。手动或 Pixiv 默认完成原先的零访问、空日期不会被填造。

phase 1 先在临时映射和预期集上核对逻辑计数及新表全字段双向差集，失败则整个事务回滚。成功后移除旧两表全部外键，再迁入 `reading_legacy_v1`；后续删除 UserBA、Artwork 或 Image 不会级联改变封存证据。去重推荐 SQL 函数同步改读新表。封存含私人账户/媒体信息，沿用受限数据库角色和备份访问控制，不为诊断或普通客户端扩大 schema 权限。

## phase 1 发布步骤

1. 固定源/目标提交与 App/Worker 镜像，检查正式 migration 文件未被改写，记录 SHA-256。确认 Web 使用 `readingLayoutVersion`、`progressCount` 与 `completed`，不再发送旧集合/单媒体标记协议；独立 Android 客户端保持暂停使用，不要求其构建或验收作为 Web 发布门禁。
2. 停外部触发与计划，等活动任务完成或按领域规则取消恢复，再停 App、Worker、扫描器、上传者及外部 NAS/维护写入。Compose stop 不能证明其他进程已停，必须按实例清单确认。
3. 在停写窗口保存同点完整检查点，校验 dump、媒体快照、配置和镜像，并在独立数据库/目录完成真实恢复演练。合成 fixture 通过不是生产副本恢复证据。完整 dump 必须包含旧两表、函数、触发器、索引和 `_prisma_migrations`，不要只导出 Prisma 模型。
4. 使用显式批准的目标连接，核对库名、主机和 schema；不要依赖脚本自动读取 `.env`。运行只读 preflight，保存受限输出与源 migration 状态。快照差异可解释且确认保留旧完成时继续；额外旧表运行时依赖须先解决。
5. 在目标版本代码/构建环境中执行正式生成与迁移。下列模板在仓库根执行，`DATABASE_URL` 应由实例管理员显式设置，不把真实值或日志秘密提交到 Git。

```bash
pnpm --filter @pixishelf/db db:generate
pnpm --filter @pixishelf/db db:status
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f packages/pixishelf-db/maintenance/reading-position-v1/preflight.sql
pnpm --filter @pixishelf/db db:deploy
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f packages/pixishelf-db/maintenance/reading-position-v1/postflight.sql
pnpm --filter @pixishelf/db db:status
```

6. **postflight 必须紧接 phase 1、且 App/Worker 等全部仍停写时执行**。它从封存源数据和当前媒体重建逐 key 预期，核对最远/最后锚点、完成、次数、日期、状态版本及逻辑总数。错 key 即使总行数相同、错误索引仍在范围内也会失败。任何失败保持停写，保留原始输出，先判明原因；不能删断言、同步旧表或改 migration history 让它通过。
7. 核验成功后启动配套 App/Worker，执行部署 READY/capability 门禁，刷新旧浏览器；独立 Android 客户端保持暂停，不使用旧版本调用新阅读协议。抽样跳页、回看、手动完成、视频开始/90%、继续阅读及普通媒体增删/重排；账户间状态独立。记录用户验收、观察起点与停止条件。

phase 1 会全量扫描媒体/旧阅读并更新每部作品缓存，持有相关表锁；维护时长取决于实例规模。停写窗口、备份容量和恢复耗时应在该实例的隔离副本上测量，开发机数字不构成生产承诺。禁止 `db:push`、手工伪造 `_prisma_migrations` 或以直接执行 phase 1 SQL 代替正式 deploy。

## phase 2 独立发布

用户验收通过后，至少持续观察 7 天；保留同点检查点和封存表，期间新程序只写新表。**不要再运行 phase 1 的全等 postflight**：上线后的真实访问、媒体变化和账户删除会合法改变目标状态，而旧表保持封存。清理前使用独立的 cleanup-preflight，核对生产发布记录、观察期、受限备份可恢复性和删除范围。

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f packages/pixishelf-db/maintenance/reading-position-v1/cleanup-preflight.sql
```

再次按备份基线建立清理前恢复依据并停相关写入者。在后续独立版本中选用新的唯一 migration 时间戳目录，例如 `YYYYMMDDHHMMSS_reading_legacy_v1_cleanup`，将 `phase2-cleanup.sql` **原样**复制为该目录的 `migration.sql`，审查后随版本发布，再执行 `pnpm --filter @pixishelf/db db:deploy` 与 `db:status`。不要在首次发布提前创建此目录，不要仅直接执行维护 SQL 或手工改 history。隔离测试直接执行清理脚本仅证明 SQL 语义，不代替生产正式 migration 流程。

清理只执行 `DROP TABLE reading_legacy_v1.artwork_read_media RESTRICT`、`DROP TABLE reading_legacy_v1.artwork_reading_summaries RESTRICT` 和 `DROP SCHEMA reading_legacy_v1 RESTRICT`，同一事务提交。未知依赖或额外对象会使清理失败并整体回滚；不得改成 CASCADE 或通配批量删除。记录清理 migration、SQL 哈希、备份依据、执行结果与用户验收材料。

## 失败与恢复

phase 1 事务失败时，新结构、回填、外键解除及封存均回滚；检查 Prisma 失败记录和实际结构后，按正式迁移故障流程处理，不能手工编造成功 history。成功后发现问题优先前向修复，保持旧表封存且不引入双写。

新位置模型已经丢弃逐项集合语义，封存表只保留切换瞬间的证据，不包含上线后的新阅读。仅换旧镜像、把旧表移回 public 或把位置推断成逐项已读都不能无损恢复。必须回退时，停止全部写入者，保全当前故障现场，按已演练的同点完整检查点共同恢复数据库/媒体/配置/配套程序，明确承认检查点之后的写入损失并记录。phase 2 后亦使用受限备份恢复，不反向补造日期、已读集合或迁移记录。
