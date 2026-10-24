---
status: historical
scope: 来源证明五个持久槽、111迁移和共享格式契约的独立窄审；无生产接线验收
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-source-snapshot-2026-10-24.md
  - docs/design/artwork-deduplication/claims-contracts.md
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-db/prisma/migrations/20261024001400_artwork_dedup_source_snapshot/migration.sql
  - packages/pixishelf-job-contracts/src/artwork-dedup-source-snapshot.ts
  - packages/pixishelf-job-contracts/src/__tests__/artwork-dedup-source-snapshot.test.ts
  - packages/pixishelf-db/src/__tests__/artwork-dedup-source-snapshot.postgres.test.ts
  - packages/pixishelf-db/src/index.ts
---

# 来源证明持久槽独立审查

2026-10-24，分支 `codex/artwork-deduplication`，基线 `6e8d4f4c98514c96233404e02acb241f0a1be20f` 上的冻结未提交小批。审查者未参与实现。初审发现一项 P2 迁移兼容门槛遗漏，原实现者窄修后已由本审查者复核关闭；本批范围没有剩余阻断问题。门禁保持3。

## 范围与证据

只审查五个 dedupSourceSnapshot Json? 字段、正式111迁移、共享来源证明模块与导出/24项契约测试、DB五槽PG测试。为核对迁移依赖，额外定向读取 DB 兼容门槛及 Worker 调用点，不扩大到来源捕获、发布、释放、文件动作或先前平台阻断的文件基础复审。产品实现只读，只新增本记录。

读取实现者原始日志：`/private/tmp/dedup-source-slot-contract-tests.log` 记录24/24通过，`/private/tmp/dedup-source-slot-pg.log` 记录1/1通过；`/private/tmp/dedup-source-slot-deploy.log` 记录 dedup_data_next 正式应用111。读取迁移比较脚本 `/private/tmp/dedup-source-slot-migration.cjs` 及 before/after 日志，核对五个升级前合成旧行逐字段不变、新值为null、五列均JSONB/nullable/无默认及精确清理的断言。本审查未重新运行脚本、测试、迁移或生成客户端，未连接任何数据库或访问媒体。

冻结核心文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `artwork-dedup-source-snapshot.ts` | `a483c643cb791ff091edcf736b73fab222533faf8b73a823f9b6fe5b190d0eec` |
| 契约测试 | `c19fd947705d2e8f896417d39781e3fb129fbb028432af1876417499b10d5910` |
| DB五槽PG测试 | `d88180d0ce4e66b6ee5734d0263553c618c8f776bb7255d44c9dd1f77628a93d` |
| 111 migration.sql | `22a72b7ab704cc0a90b5d075dbd50c96fbce33cbc9ab917dcdc8598b110ba621` |

## 初审发现

### P2（已修复并复核）：新客户端需要111，但 Worker 启动兼容门槛仍接受110

位置：[DB index.ts](../../packages/pixishelf-db/src/index.ts) 第18、126、215–216行；关联 [Worker main.ts](../../packages/pixishelf-worker/src/main.ts) 第102行。

新 Schema/生成客户端已包含五个字段，但 latestRequiredMigration 仍为 `20261024001300_artwork_dedup_reference_indexes`；assertBackgroundQueueSchema 的列检查也不包含五个新列。因此一个完整110数据库会通过 Worker 的 schema preflight，随后新客户端对这些表的默认全字段查询会请求不存在的 dedupSourceSnapshot，产生缺列故障。这不依赖生产来源证明接线：例如既有 [archive/phase-handoff.ts](../../packages/pixishelf-job-executors/src/archive/phase-handoff.ts) 第19行已经默认读取 ArchiveImport 全字段。

证据为静态代码和迁移差异：111迁移新增列；现有门槛只核对110迁移及旧列集合，旧 database-client 单测的 latestMigration 也仍指向110。没有为复现连接其他110/106专库；新客户端不能在这些库上盲跑的限制保持有效。

最小修复为将最低迁移号推进到111，同步兼容性单测，并明确验证只报告110的 schema 被拒绝、111被接受。无需新增生产接线或重跑媒体/规模测试。初审时此项保持待修；最终关闭依据见末尾窄复核。

## 其余核验结论

- 五个 Prisma 字段分别属于 ScanRunMetadataInput、ScanRunLocalWorkInput、PixivSourceAuditItem、ArchiveIntakeItem、ArchiveImport；实际映射表与111的五次 ADD COLUMN 一致。迁移无默认、NOT NULL、UPDATE、数据删除或回填。SQL可空值是历史无证明，不自动等同generation 0。
- 共享格式顶层、proof和三个identity分支均strict；只接受version 1、一至两项。PROVIDER、PATH、DIRECTORY严格区分字段；路径规则与现有DB规范相对路径一致，只有DIRECTORY允许空根路径。重复身份按固定字段元组比较，不依赖客户端键顺序；重复sourceId另行拒绝。
- generation仅接受规范十进制字符串0至9223372036854775807；无符号、前导零、指数、number、负数和超上界均拒绝。serialize只接受bigint并转十进制，再复用完整schema；不经number，不trim，不默认0。
- parse对null/undefined/旧版本/额外字段直接报错；没有捕获当前代次或持久更新旧行的helper。固定元组仅用于重复判断，没有另造DB身份hash。
- 格式允许合成sourceId/identity组合，因此parse成功不证明真实绑定、OPEN、当前代次或权限；契约明确保留后续DB核验。仓库定向搜索显示新字段/格式只在Schema、迁移、共享导出及两组测试中使用，没有生产消费接线或客户端mutation输入。
- 五槽PG测试以同一事务写入五个省略值和五个合成证明，再主动回滚；省略值返回null且parse拒绝，证明往返不损失大于JS安全整数的代次。它不是来源授权或生产handoff证明。24项契约测试包含核心正反边界；路径深度、长度和DIRECTORY空根等其余边界由schema静态核验，未冒称全部有独立用例。

## 限制与文档检查

旧任务null拒绝接线、有界多身份capture/assert、真实sourceId一致性、来源HOLD/代次、重试复制、staging登记/drain、双向重叠释放和生产入口仍未实施，不能据本次格式/存储审查开放。没有重跑全量build/test、规模测试或图示检查，也没有连接任何110/106隔离库。

新增记录运行 `pnpm docs:check`，日志保存于 `/private/tmp/dedup-source-snapshot-review-docs.log`；本批不改图源。迁移门槛修复后的窄复核另记于本记录末尾。


## P2 修复窄复核

同日复核原实现者冻结的最小修复，仅核对 DB index.ts 的最低迁移与五列检查、database-client.test.ts 的相关 mock/拒绝用例及实现记录末段，没有扩大到其他范围，也未重新运行 PG 或全量检查。

修复后 index.ts 第18行要求正式111迁移；第20–26行固定五个映射表名，第110/121行在既有 information_schema 查询中返回完整 table.column 标识并只选择这些表的 dedupSourceSnapshot，第212–215行逐一拒绝缺列。第229–230行继续要求完成且未回滚的迁移记录。因此只具110迁移但手工补列的库仍拒绝；有111记录却缺任一列也拒绝。既有其他 schema 检查保留，没有增加来源捕获或生产发布接线。

database-client.test.ts 第102–126行分别覆盖五个缺列分支，第158–178行覆盖完整列集合但只有110迁移的拒绝；完整schema成功用例同步为111及五列。已读取 `/private/tmp/dedup-source-slot-schema-unit.log`（32/32单测，11 PG跳过）及 `/private/tmp/dedup-source-slot-schema-pg.log`（dedup_data_next111的既有只读catalog用例1/1，其他42跳过）。这些是原实现者运行证据，本复核未连接数据库，不执行删列、改迁移历史或任何DDL；没有访问其他110/106专库。

冻结 SHA-256 为 index.ts `e14d05c980d1656e44a0788a36809c30cb6920c870c442bc693e8eab08792c9d`、database-client.test.ts `e800cd565d550d5b5559b9b5216d6bbd3d93f028ec3ddad0c12714999ae13e2c`。修复准确覆盖初审问题，P2关闭，无新增阻断发现。来源证明存储/格式结论及全部生产接线限制保持原范围，门禁仍为3。

原实现者文档日志 `/private/tmp/dedup-source-slot-schema-docs.log` 为237份通过；本审查更新后的文档检查结果仍记录于 `/private/tmp/dedup-source-snapshot-review-docs.log`。
