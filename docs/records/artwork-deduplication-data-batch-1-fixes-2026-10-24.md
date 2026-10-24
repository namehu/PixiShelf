---
status: historical
scope: 去重数据与接口第一批三项审查修复及安全收口快照
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-data-batch-1-review-2026-10-24.md
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - packages/pixishelf-db/src/artwork-dedup-review.ts
  - packages/pixishelf-db/src/artwork-dedup-operation.ts
  - packages/pixishelf-db/src/artwork-dedup-ownership.ts
  - packages/pixishelf/services/artwork-dedup-review-service.ts
---

# 数据首批差异修复与续接

2026-10-24 01:14，基线 c2d6be73，codex/artwork-deduplication 工作树未提交。按统筹安全收口要求完成正在进行的必要定向验证后停下；不启动封面、guard、离线恢复等下一批。发布门禁保持2。本记录不代表第三阶段完整验收，也不提升高级真实入口。

## 可供差异复审的三项修复

- READY 最终文件阻断条件纳入 inspectionStatus；PENDING 和 BLOCKED 均不能发布。现有真实 PG 完成窗口测试仍验证阅读不使授权失效、账户级联删除不能穿过 READY 事务锁。
- ALL_RECOMMENDED 持久保存完整 run 组集合，用户明确排除为 EXCLUDED/USER_EXCLUDED，并计入 excludedGroups；排除组不生成 OperationArtwork。三组排除一组回归断言 selected=2、excluded=1、明确历史行和没有排除成员。
- getOperation FILES 指定 artworkId 时先查 OperationArtwork 复合主键。跨操作/未知 ID 拒绝；合法但尚无文件的成员返回空页。输入范围测试使用事务 double，私人投影仍使用真实 PG。

## 本轮已落盘的接口工作，尚未完整验证

- 新 artwork-dedup-ownership.ts 根据冻结根映射在数据库内查询全库 Image.path、chaptersPath、Artwork.metaSource、ArchiveRevision.manifestPath，覆盖 caller ownershipStatus；未知附件、无匹配引用、跨作品/跨角色共享引用阻断。saveFilesPage 按当前页调用，最终完成再检查全部清单。
- completePrepare 只聚合 COPY 唯一物理根/路径，keeper 不计入；COPY 阻断或未知大小为 null，preparedFiles 仍为所有清单行。正常完成回归已断言两行文件仅10字节副本；检查未完成的副本 logicalBytes 为 null。
- snapshot helper 增加可选 artworkId；逐页仅核对当前冻结成员，默认仍为最终全范围。尚未补单成员与大范围专门回归。
- Inventory 每页返回真实 archiveItem pageIndex/stagedPath/sha256/byteCount；readArtworkDedupArchiveManifestEvidence 对 sealed/drained publication 与真实 Image/检测媒体映射给出封印摘要。映射使用单次集合聚合和唯一 item/image 计数，不逐图片扫描全部 import items；类型检查通过，但该 SQL 的真实归档有效/篡改案例尚未执行。
- 正式迁移110 `20261024001300_artwork_dedup_reference_indexes` 为上述规范路径查询增加5个索引，并同步 readiness 最新迁移。已成功 deploy 到 dedup_data_next，日志 `/tmp/dedup-data-fix-deploy-110.log`。executor_next 的110部署交执行器所有者；本线没有操作 dedup_scale。110 已应用，后续不得重写历史迁移。

以上接口代码与 review 完成函数有直接依赖，保留在本次冻结快照，但三项P2的通过证据不能代替跨引用、归档封印和规模验证。封面新 GET 路由仅已写契约，尚无业务代码，thumbnailUrl 仍为空。

## 实际验证

- DB PG：`pnpm exec vitest run src/__tests__/artwork-dedup-review.postgres.test.ts`，5/5通过，日志 `/tmp/dedup-data-fix-p2-pg-retry.log`。首轮3/5，两个新 fixture 因前例未释放唯一 BACKGROUND_WRITER lane 失败；增加每例只删除本次创建 job ID 的清理后重跑同一文件通过。首轮日志 `/tmp/dedup-data-fix-p2-pg.log`，没有隐藏失败或修改产品 lane 约束。
- App：`pnpm exec vitest run services/__tests__/artwork-dedup-review-service.postgres.test.ts`，4/4通过，日志 `/tmp/dedup-data-fix-p2-api.log`。
- DB `pnpm typecheck`通过，日志 `/tmp/dedup-data-fix-db-tsc.log`。本轮未重跑全 App tsc；前一批类型证据见首批记录。
- 以上 PG 都只使用 loopback55432 的 dedup_data_next。fixture 删除仅按本轮 UUID/ID 范围，不写真实媒体、不碰 scale。
- 应用全小写路径检查无输出。未启动浏览器、未运行全量 build/lint/test，未重跑图表或额外全量验证。文档最终门禁交统筹统一收口。

## 本轮差异冻结文件

- `packages/pixishelf-db/src/artwork-dedup-review.ts`
- `packages/pixishelf-db/src/artwork-dedup-operation.ts`
- `packages/pixishelf-db/src/artwork-dedup-ownership.ts`（新增）
- `packages/pixishelf-db/src/__tests__/artwork-dedup-review.postgres.test.ts`
- `packages/pixishelf-db/prisma/migrations/20261024001300_artwork_dedup_reference_indexes/migration.sql`（新增）
- `packages/pixishelf-db/src/index.ts`（最新迁移110，既有 wildcard 导出新 helper）
- `packages/pixishelf-db/src/__tests__/database-client.test.ts`（最新迁移110）
- `packages/pixishelf/services/artwork-dedup-review-service.ts`
- `packages/pixishelf/services/__tests__/artwork-dedup-review-service.postgres.test.ts`
- `docs/design/artwork-deduplication/phase-3-contracts.md`（末节修订）
- 本记录。

`docs/design/artwork-deduplication/claims-contracts.md` 是首批审查等待期间的未实施草稿，不是声明/guard交付；没有对应业务模块。未修改独立审查记录或其他实现者文件。

## 后续顺序与续接命令

先由原独立审查者复核上述三项修复；四接口的缺失定向证据由下一批补齐，结合执行器真实 PREPARE 结果。随后才做已批准的鉴权ID封面路由（匿名/切换账户/隐藏对象/有效图片）；operation reader 离线恢复 helper 与 PAUSED/BUILDING 在退出证明后的恢复入口仍未完成，不能直接清 token 或伪造失败绕过。长期声明、来源 hold/drain、写入口守卫、隔离恢复、purge/tombstone/显式重导/历史GC未实施完，不得放开门禁。

在授权恢复后，测试环境变量仅指向专库：

```bash
export QUEUE_KERNEL_TEST_DATABASE_URL='postgresql://dedup:dedup-fixture-only@127.0.0.1:55432/dedup_data_next?connection_limit=20&pool_timeout=20'
pnpm --filter @pixishelf/db exec vitest run src/__tests__/artwork-dedup-review.postgres.test.ts
pnpm --dir packages/pixishelf exec vitest run services/__tests__/artwork-dedup-review-service.postgres.test.ts
```

也可直接进入对应包执行本记录已验证的 `pnpm exec vitest run ...`。不需要为此次索引迁移重新 generate。继续修改前先读统筹最新状态，不能自行假定停工解除。
