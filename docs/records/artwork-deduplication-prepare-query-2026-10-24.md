---
status: historical
scope: D3-05 PREPARE 最终清单完整性查询的定向诊断与修复
last-verified: 2026-10-24
sources:
  - packages/pixishelf-db/src/artwork-dedup-review.ts
  - docs/design/artwork-deduplication/phase-3-contracts.md
---

# PREPARE 最终成员查询

只使用 executor 交接的独立 `dedup_prepare_scale`（正式迁移110）SQL fixture，operation `8e09708b-7a3a-45d9-98f3-64c0b08b481d`，1,000作品、500,000清单行。本次不重读原文件、不改 `dedup_scale`、不执行文件动作；第四阶段 claims 基础尚未改代码，保持暂停。

首次 completePrepare 的 Image→OperationFile 缺失成员计数在30.001秒触发 statement_timeout，整个事务回滚。该次插入后 autoanalyze 尚未完成，不能据此推断正常统计下必然超时。后续 autoanalyze 完成后，用原 SQL 在只读事务内执行一次 `EXPLAIN (ANALYZE,BUFFERS,TIMING OFF)`，30秒上限，成功耗时17,461.092毫秒。MEDIA 子计划仍通过 `(operationId,artworkId,fileId)` 索引定位作品后过滤 imageId/role，500,000次循环、每次平均过滤250行；总体10,586,444 shared hits、38,726 shared reads。由此确认成员核对存在随单作品媒体数放大的重复扫描，不仅是首次统计延迟。

最小修复沿用既有规范引用键和唯一索引；MEDIA/CHAPTER 同时核对 referenceKey、artworkId、imageId、role。无需 schema 或迁移，不改锁顺序、完整性语义、门禁或所有权判断。

诊断原始文件保留 `/private/tmp/dedup-prepare-scale-missing-plan.sql`、`/private/tmp/dedup-prepare-scale-missing-plan.json`、`/private/tmp/dedup-prepare-scale-missing-current.sql`、`/private/tmp/dedup-prepare-scale-missing-current.log`、`/private/tmp/dedup-prepare-scale-indexes.txt`。本记录不等于 D3-05 整体通过，ownership 和最终聚合还需 executor 续接验证。

## 改后测量与验证

同一500,000行 fixture，仍在只读事务中使用相同30秒上限执行一次改后 EXPLAIN ANALYZE：2,273.583毫秒，MEDIA 子计划命中既有 `ArtworkDedupOperationFile_operationId_referenceKey_key` 唯一索引，500,000次循环、每次过滤0行。总 shared hits 1,965,793、shared reads 44,968。两次测量的缓存状态不完全相同，因此不将耗时比作为固定性能保证；关键证明是作品内重复过滤已消除。fixture 本身没有章节引用，章节分支由小规模真实 PG 回归覆盖。

仅运行新增 `artwork-dedup-prepare-completeness.postgres.test.ts`，独立 `dedup_data_next`：6/6通过。涵盖正确媒体和章节、规范键错误、imageId/Artwork/role错配、登记章节缺失；失败保留 BUILDING/version1，不能发布 READY。日志 `/private/tmp/dedup-prepare-completeness-tests.log`。受影响DB包 typecheck 通过，日志 `/private/tmp/dedup-prepare-completeness-types.log`。普通App路径大小写检查无命中；没有修改App代码。

改后 SQL/计划保留 `/private/tmp/dedup-prepare-scale-missing-indexed.sql` 与 `/private/tmp/dedup-prepare-scale-missing-indexed.log`。本次不重新跑扫描、PREPARE文件读取、全套测试或构建，不改变生产迁移。等待独立窄复审；executor可在保留fixture继续完整最终事务，不能把本条查询成功直接记作完整D3-05通过。

## 本批冻结范围与续接

- `packages/pixishelf-db/src/artwork-dedup-review.ts`：仅最终 missing MEDIA/CHAPTER 子查询各补一项 referenceKey 条件。
- `packages/pixishelf-db/src/__tests__/artwork-dedup-prepare-completeness.postgres.test.ts`：新增6项回归。
- `docs/design/artwork-deduplication/phase-3-contracts.md`：固定规范引用键与完整性定位规则。
- 本记录。

定向复现：以 `QUEUE_KERNEL_TEST_DATABASE_URL` 指向 `dedup_data_next`，运行 `pnpm --filter @pixishelf/db exec vitest run src/__tests__/artwork-dedup-prepare-completeness.postgres.test.ts`。规模查询通过 psql 对 `dedup_prepare_scale` 运行上述保存SQL，禁止改用 `dedup_scale` 或真实库。未启动第四阶段声明实现，未覆盖后续完整 ownership/聚合、浏览器、50万真实文件PREPARE最终验收。
