---
status: historical
scope: 第四阶段来源证明五个持久槽、共享严格类型与正式111迁移小批
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/claims-contracts.md
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-db/prisma/migrations/20261024001400_artwork_dedup_source_snapshot/migration.sql
  - packages/pixishelf-job-contracts/src/artwork-dedup-source-snapshot.ts
  - packages/pixishelf-db/src/__tests__/artwork-dedup-source-snapshot.postgres.test.ts
---

# 来源证明持久槽与契约

2026-10-24，worktree artwork-deduplication/PixiShelf，基线6e8d4f4c上的未提交小批。门禁保持3；只增加存储和格式能力，不接任何生产执行入口。

## 精确冻结文件

- Prisma schema 只在 ScanRunMetadataInput、ScanRunLocalWorkInput、PixivSourceAuditItem、ArchiveIntakeItem、ArchiveImport 各新增 dedupSourceSnapshot Json? 和语义注释；schema 中其他未提交改动属于之前批次。
- 正式111迁移 20261024001400_artwork_dedup_source_snapshot，仅五次 ADD COLUMN JSONB，nullable、无默认、无UPDATE回填。110未改。
- job-contracts 新 artwork-dedup-source-snapshot.ts、同名 **tests** 单测；index.ts 仅新增该模块导出。
- DB 新 src/**tests**/artwork-dedup-source-snapshot.postgres.test.ts。
- [声明契约](../design/artwork-deduplication/claims-contracts.md)新增实际导出与阶段边界，本记录。

同一严格版1对象最多两项。代次只用规范十进制字符串，序列化输入要求 bigint；缺失/null拒绝，没有补捕获或默认0。source identity 规则复用DB语义；DB仍是唯一身份hash编码者。格式校验不是实际来源绑定/OPEN/代次有效性校验，不向客户端公开新输入。

## 迁移隔离与恢复依据

只对 loopback PG55432 的 dedup_data_next 正式 migrate deploy，从110到111。未触及 dedup_scale106、dedup_prepare_scale110、dedup_executor_next110或真实服务数据库；迁移不扫描媒体。

生成前分别解析 worktree 与主目录 @prisma/client 和 .prisma/client 的真实路径；均在各自 node_modules/.pnpm，生成入口 inode 分别84222363与83768037，非共享文件。生成仅输出 worktree，主目录保持原客户端。其他仍在110的隔离库不能用新客户端盲跑会选择这五表全字段的测试，后续部署由统筹单独授权。

升级前在五张旧表各建立一条合成记录并保存全部旧字段；升级后逐字段完全相同，新增字段全部为null。信息架构查询确认五字段均JSONB、nullable且无默认。比较脚本 /private/tmp/dedup-source-slot-migration.cjs 与快照 /private/tmp/dedup-source-slot-before.json 可核查；两阶段原始日志为 /private/tmp/dedup-source-slot-before.log 和 /private/tmp/dedup-source-slot-after.log。精确夹具清理完成。

首次准备脚本的合成ARCHIVE_DOWNLOAD任务遗漏lane，被既有DB约束拒绝；仅一个空ScanRun已按精确ID清理，修正lane后重新建立对照并成功完成。没有回滚或修改数据库约束。

本迁移为可空增量槽；代码回退时保留列和已有证明，旧代码可忽略额外列。不要为回退DROP列或用当前代次回填null；进入接线前必须保持旧无证明任务拒绝的既定门槛。

## 实际验证

| 检查                      | 结果                                | 原始日志                                                                                       |
| ------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| 正式迁移                  | 111成功，仅data_next                | /private/tmp/dedup-source-slot-deploy.log                                                      |
| Prisma generate           | worktree客户端成功                  | /private/tmp/dedup-source-slot-generate.log                                                    |
| 五旧行无损迁移            | 全字段相同且新值null；已清理        | before/after日志见上                                                                           |
| 共享契约                  | 24/24通过                           | /private/tmp/dedup-source-slot-contract-tests.log                                              |
| 五槽真实PG往返            | 1/1通过，包含五个null和五个精确证明 | /private/tmp/dedup-source-slot-pg.log                                                          |
| DB / contracts TypeScript | 均通过                              | /private/tmp/dedup-source-slot-db-types.log、/private/tmp/dedup-source-slot-contract-types.log |

契约覆盖大于JS安全整数的代次、signed bigint边界、null/旧版本/额外字段、重复身份/ID、超过两项、非规范路径与代次、number序列化拒绝。PG测试仅写专库，全部夹具同事务回滚；测试不把合成proof当真实来源授权。无全量build/test、浏览器或媒体I/O。

## 后续仍未实施

有界多身份锁序capture/assert、五个生产冻结/复制/发布入口、旧任务null拒绝接线、目录双向重叠generation传播、release、URL hold drain及文件动作均不在本批。没有给旧输入补证明的持久helper：新创建或复制使用生成Prisma字段，原意图不得在恢复时换代。真实旧来源ID/代次一致性仍待后续DB helper验证，不能因为parse成功就放行。

最终 docs:check 236份通过（/private/tmp/dedup-source-slot-docs.log），受影响既有文件 diff --check 无错误。生成后再次读取两处生成 schema：worktree新增证明字段5个，主目录0个。没有图源变更，不重复图示检查。

## 独立审查 P2：启动兼容门槛修复

独立审查指出新客户端默认全字段查询已依赖111，但 Worker 所用 assertBackgroundQueueSchema 仍接受110。本次窄修只修改 DB src/index.ts、src/__tests__/database-client.test.ts 和本记录：最低完成迁移改为20261024001400_artwork_dedup_source_snapshot；沿用现有 information_schema.columns 查询，逐一要求五张表的 dedupSourceSnapshot 列。迁移记录与实际列均须满足，不能以手工加列代替正式迁移，也不能只凭111记录忽略缺列。

同步现有mock的完整列集合，增加五个逐列缺失拒绝用例，并把上一版迁移拒绝用例明确为110（其余列齐全）。32项单元测试全部通过，11项PG用例在该次运行中跳过，日志 /private/tmp/dedup-source-slot-schema-unit.log。随后只在 dedup_data_next 运行既有真实 catalog 完整结构只读用例，1/1通过、其余42项跳过，日志 /private/tmp/dedup-source-slot-schema-pg.log。没有执行删列、修改迁移历史等PG用例，没有再次deploy/generate，更未连接其他隔离库或真实环境。

本修复不改变来源证明格式、捕获/发布或gate3；没有重跑前批已通过的契约/往返/类型检查或任何全量测试。受影响文件 diff --check 与主应用全小写路径检查通过。最终 docs:check 237份通过，日志 /private/tmp/dedup-source-slot-schema-docs.log；没有图源变更。修复交由原独立审查者窄复核，尚不以实现者自检代替审查关闭。
