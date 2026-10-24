---
status: historical
scope: 扫描冻结、增量、审计与发布消费持久来源证明的执行器小批；不代表去重阶段四整体完成或生产验收
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/claims-contracts.md
  - docs/records/artwork-deduplication-source-groups-2026-10-24.md
  - packages/pixishelf-job-executors/src/scan/dedup-source-snapshot.ts
  - packages/pixishelf-job-executors/src/scan/inventory-run.ts
  - packages/pixishelf-job-executors/src/scan/consistency-audit-executor.ts
  - packages/pixishelf-job-executors/src/scan/__tests__/scan.postgres.test.ts
---

# 扫描持久来源证明接线

2026-10-24；工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，分支 `codex/artwork-deduplication`，HEAD `6e8d4f4c` 加现有未提交变更。本批冻结扫描执行器及相应测试，尚待独立审查；保留原扫描内容读取器的此前修改。发布 gate 仍为3，没有实施实际 ISOLATE、RESTORE 或 PURGE 文件动作。

## 实施范围与恢复边界

- `dedup-source-snapshot.ts` 复用 job-contracts 的严格 parse/serialize 与 DB single/groups capture/assert。Pixiv 只接受恰好一个 `pixiv` PROVIDER 与精确元数据 PATH，校验冻结文件名外部ID；本地只接受一个已确认 LOCAL_DIRECTORY 的 DIRECTORY。根身份来自 `resolveMediaContentRoots` 的受信物理根摘要，不把 Pixiv UUID 标记或平铺父目录当所有权。
- 增量发现每页先按持久行复用原证明，对本页新候选在读 metadata 内容前捕获新证明；原 fenced 页事务对所有候选统一 assert，随后写 inventory、失败观察、changed 输入与计数。unchanged 页同样检查，输入仍可为零。不能把先前未提交页的 hash/分类配上后来代次，`PROCESS_STORED_HASH` 候选重新读文件内容。
- 已落盘输入即使 `inputFrozenAt` 为空也不删除重建；恢复逐路径核对原 ordinal、hash、stat 和证明，保留原 sourceId/generation。null、变化或丢失旧输入均拒绝。未提交任何输入的发现页可以重新发现，但上次读取结果不复用。旧全量冻结适配器要求调用方供应读取前取得的证明，不在收到预先计算的 hash 后才捕获。
- Pixiv 处理、SKIP 的 lastSeen/baseline、最终发布和审计 Apply 使用原证明；已有 Artwork 的内容发布检查全局 Claim。Local 导入/重扫同时保留原目录快照及受信根检查，重扫限定 `createdVia=LOCAL_DIRECTORY`。
- 审计输入冻结同样保留证明；观察将其复制到 `PixivSourceAuditItem`，Apply 对审计和输入证明逐字段一致性校验并在最终事务 assert。MISSING 没有输入证明，继续仅报告，不补捕获。
- 来源拒绝后只允许原 fence 的任务失败、取消及检查点回执，不重写 inventory 的外部身份/hash/lastSeen。普通内容错误若要更新 inventory，也须在同事务验证原证明；期间发生 HOLD/换代则回滚后仅写失败回执。
- 为保持既有1200行规则，把审计的两个现有根/库存屏障原样移到 `audit-root-guard.ts`。App 消费的纯身份/parse/转换助手经既有 scan export 链公开；未扩客户端 payload。

本批另补 ArchiveProvider 新必填 `identifySource` 在 governor 的纯透传与六个既有测试文件的合成 provider 方法，仅用于接口兼容；归档 RESOLVE→PUBLISH 主体尚未在本批接线。

## 隔离库正式升级与保全

只连接 loopback 55432 的 `dedup_executor_next`。迁移前只读确认正式迁移110，最新 `20261024001300_artwork_dedup_reference_indexes`；五个新增证明槽对应表当时均为0行，因此本次不能声称实际验证了这些表的非空旧行升级。全库旧内容已在迁移前导出。

- 完整 custom-format dump：`/private/tmp/dedup-executor-next-before-111-20261024.dump`。
- SHA-256：`92b727a0b177e77a2ab4293dc3fd0b0c4bedab7a73b5608a5867b592c4fc9765`。
- 显式指定该隔离库运行 `pnpm --filter @pixishelf/db db:deploy`，正式应用111 `20261024001400_artwork_dedup_source_snapshot`；未用 db:push。
- 升级后只读确认111条正式成功迁移、五个 JSONB 列均 nullable 且无默认。没有迁移 `dedup_scale`、`dedup_prepare_scale` 或访问 App/data 线专库。
- 调试首个合成用例时发现混用了 Pixiv UUID 与媒体根摘要，已修正为受信 resolver。只移除该失败用例本轮新建的精确根协调行 `facb6a8e-ea43-4507-90ad-5190e75d99dc`（创建时刻 `2026-10-24 02:22:02.793` UTC），没有清空库或删除既存去重证据。后续测试使用既有 fixture 定向清理。

此 dump 是本次隔离库迁移前的保全材料，未执行恢复演练，不标记为经过完整恢复验证的生产备份。

## 最小验证

1. `pnpm --filter @pixishelf/job-executors typecheck` 通过。
2. 指定 `QUEUE_KERNEL_TEST_DATABASE_URL` 为上述隔离库，运行 `scan.postgres.test.ts` 的15个定向用例：发现读前捕获到页提交之间的 HOLD/REOPEN、冻结后 HOLD/换代/null、unchanged 页拒绝、本地 DIRECTORY OPEN/STALE/null、页提交后崩溃保留原证明、NEW/CHANGED Apply、新建阅读初始化、增量baseline、完整审计分类；15/15通过，其他54项未运行。
3. `checkpoint.test.ts`、`run-store.test.ts`、`local-rescan.test.ts`、`dedup-source-snapshot.test.ts` 四个局部单元套件38/38通过。新合成 fixture 在创建时提供证明，未给生产旧任务回填。
4. 定向 oxlint 已消除新增错误；仍报告三个此前存在的 max-params（`recordInputFailure`、`recordItemOutcome`、`writeOutcome`）及一个原有 no-control-regex 警告。未宣称全量lint通过。
5. 主应用大小写路径检查无匹配。`pnpm docs:check` 检查242份Markdown通过；`pnpm docs:diagrams:check` 因本机缺少 Playwright `chromium_headless_shell-1194/chrome-mac/headless_shell` 未能运行。本批未修改图源，未下载或安装浏览器。

HOLD/REOPEN 用例仅通过明确的合成 fixture 状态/代次变化模拟竞争；不是实际双向 release 协议验收。未重跑全量测试、build、规模样本或浏览器；未完成历史整套fixture迁移。归档证明链、真正URL drain/普通归档hold、双向来源释放以及受平台阻断的文件基础独立复审仍属后续批次。

## 冻结后测试夹具更正（暂停前）

原 HOLD 合成夹具遗漏 ownerOperationId，部分负例可能只捕获数据库 CHECK 异常，不能作为来源周期验收证据。已仅修正 scan.postgres.test.ts：真实 HOLD→OPEN/generation 读回、注入完成旗标、hook 外确切来源错误码、FAILED checkpoint 与零领域写入断言。最后实际复验同组 15/15（54 skipped）通过。discovery/unchanged 页持久诊断仍被既有 lifecycle 泛化，生产未改。精确修正项、运行先后及暂停缺口见[归档来源证明暂停交接](artwork-deduplication-archive-sources-pause-2026-10-24.md)。
