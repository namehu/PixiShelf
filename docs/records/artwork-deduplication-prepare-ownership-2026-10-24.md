---
status: historical
scope: D3-05 最终归属复核的有界回写和失效语义窄修
last-verified: 2026-10-24
sources:
  - packages/pixishelf-db/src/artwork-dedup-ownership.ts
  - packages/pixishelf-db/src/artwork-dedup-review.ts
  - docs/design/artwork-deduplication/phase-3-contracts.md
---

# 最终归属复核与失效

本批接续[成员查询修复](./artwork-deduplication-prepare-query-2026-10-24.md)。只诊断独立 `dedup_prepare_scale` 的同一 SQL-only operation `8e09708b-7a3a-45d9-98f3-64c0b08b481d`。未改 `dedup_scale`，未重读媒体、运行HTTP或执行原生文件动作；第四阶段声明仅固定设计，尚未开始产品实现，门禁仍3。

## 实际问题与测量条件

executor 的一次完整最终事务在缺失成员核验2,403毫秒后，归属 `WITH ... UPDATE` 于30,019毫秒触发 statement_timeout，事务整体32,594毫秒回滚，未执行容量汇总。该测量脚本曾给事务35秒预算，因此不能按生产30秒事务约束记为通过；修复后只允许使用生产预算继续验证。

仅将原归属SQL的最终UPDATE替换为只读决策计数，使用相同CTE和30秒上限，EXPLAIN ANALYZE测得3,311.723毫秒。另一次只读分组计数明确得到 `SHARED_PATH | 500000 | 500000`：全部50万行确实需要变化，并不是可直接跳过的无变化清单。原合成导入把所有 ownershipStatus 设为UNCONFIRMED；共享路径证据也不能伪装成合法唯一路径。页面实际已经逐页保存的正常清单通常不需要这种全量重写，但最终遇到真实大范围变更仍须安全处理。

18:19:54 UTC统计记录503,350存活行、386,409死元组，last_autoanalyze为18:13:02.342 UTC，之前last_autovacuum为18:13:00.897 UTC。之后自动清理于18:20:29.594 UTC运行，18:26:31 UTC复查死元组为0；未手工VACUUM/ANALYZE。诊断查询与最初失败的缓存/自动清理条件不同，不能将3.31秒与30秒直接作为固定性能比。原始计划、计数和时点保留于 `/private/tmp/dedup-prepare-scale-ownership-plan.{sql,json}`、`-read.{sql,log}`、`-counts.{sql,log}`、`-stats.txt`、`-after-read-stats.txt`（均以上述ownership前缀展开）。

## 变化与不变量

归属SQL仍核对完整清单及全库登记引用，并按唯一物理路径识别共享引用。仅对 ownershipStatus/status/blockReason 真正变化的行写入，每次按fileId稳定顺序最多100行，返回 changedFiles/updatedFiles/totalFiles。分页保存本身上限100，因此不截断正常页结果，也不在JavaScript加载全清单。

最终复核出现 changedFiles > updatedFiles 时，同一个原有围栏事务保存100行真实诊断，并将 operation 置STALE/OWNERSHIP_CHANGED、logicalBytes=null、preparedFiles=totalFiles，保留全部冻结Artwork/File和原执行版本。不能发布READY，不能通过旧操作重试逐次“洗掉”失效；只能重新PREPARE原范围，逐页重建全部证据。≤100条变化全部落盘后沿既有FAILED/READY判定；不变行不改updatedAt，验证时间仍由操作validatedAt表达。

App的真实领域DTO与mutation共用既有retry predicate：STALE只返回REPREPARE，RETRY拒绝。容量投影为null，UI不显示可执行数字；现有STALE提示和“重新预览原范围”入口复用，不改UI代码。没有新增schema/迁移、超时放宽、所有权绕过或释放声明入口。

## 定向验证与冻结范围

- 新DB测试 `artwork-dedup-ownership-finalize.postgres.test.ts`：3/3。无变化时完整核验且文件时间戳不变；100条迟到跨角色引用完整写入并FAILED；104条变化回写100条并STALE。两种变化均覆盖事务回滚、全部冻结范围和真实诊断保留。
- 既有 `artwork-dedup-maintenance-boundaries.postgres.test.ts -t 'foreign|duplicated COPY'`：4/4，另2项未选；覆盖章节/meta/manifest共享引用与COPY容量去重。
- App `artwork-dedup-resume.postgres.test.ts -t 'stale ownership'`：1/1，另1项未选；真实服务拒绝旧STALE清单重试，DTO只有新预览动作与空容量。
- DB包类型检查通过；没有全量build/lint/test、浏览器或原生文件验证。

日志 `/private/tmp/dedup-ownership-finalize-tests.log`、`/private/tmp/dedup-ownership-existing-tests.log`、`/private/tmp/dedup-ownership-stale-service-tests.log`、`/private/tmp/dedup-ownership-types.log`。定向PG仅使用 `QUEUE_KERNEL_TEST_DATABASE_URL` 指向 `dedup_data_next`，测试产生的数据已按独立前缀清理。

本批冻结：`artwork-dedup-ownership.ts`、`artwork-dedup-review.ts` 的ownership计数分支、新DB测试、既有App resume测试新增STALE用例、phase-3-contracts的有界归属复核段及本记录。此前成员查询的两项索引条件保留，不在本批重复实现。`claims-contracts.md`只是尚未实施的独立设计，不属于本次性能验收。

待独立Sol复审代码与契约一致性，再由executor使用生产30秒围栏事务仅续一次原fixture完整finalize，验证成功提交STALE且保留100条诊断。尚未证明有效50万唯一路径清单的最终READY容量汇总，也未完成浏览器或50万真实文件PREPARE验收，本记录不代表D3-05整体通过。
