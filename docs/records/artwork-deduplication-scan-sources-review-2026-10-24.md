---
status: historical
scope: 扫描持久来源证明接线的未完成独立窄审；保留静态发现和证据限制，不代表验收通过
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/claims-contracts.md
  - docs/records/artwork-deduplication-scan-sources-2026-10-24.md
  - packages/pixishelf-job-executors/src/scan/dedup-source-snapshot.ts
  - packages/pixishelf-job-executors/src/scan/scan-executor.ts
  - packages/pixishelf-job-executors/src/scan/pixiv-publisher.ts
  - packages/pixishelf-job-executors/src/scan/local-publisher.ts
  - packages/pixishelf-job-executors/src/scan/audit-apply-executor.ts
  - packages/pixishelf-job-executors/src/scan/__tests__/scan.postgres.test.ts
---

# 扫描来源证明独立审查中间记录

2026-10-24，按指定 GPT-6.1 Sol / xhigh 独立审查工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，分支 `codex/artwork-deduplication`，HEAD `6e8d4f4c98514c96233404e02acb241f0a1be20f` 加多人未提交修改。仅新增本记录，未修改生产代码或测试。因用户要求控制额度，本轮在静态审查阶段收口，**审查尚未通过，也未完成全部预定范围的逐项验证**；不提高发布 gate 3。

## 已确认的静态可行动发现

### P1：发布事务在根与来源锁之后才取得 creator catalog

主要位置：`packages/pixishelf-job-executors/src/scan/scan-executor.ts` 第372–378行、`pixiv-publisher.ts` 第57行及第123行。相同顺序也存在于 `audit-apply-executor.ts` 第425–431行至第463行的发布调用，以及 `local-publisher.ts` 第28–31行至第56行的新建作品路径。

扫描最终事务先调用目录快照或持久来源断言，取得根协调与来源行锁。随后 Pixiv 刷新执行 Artwork UPDATE，新建执行 Artist/Artwork INSERT；本地导入执行 Artwork INSERT。这些语句会触发正式迁移 `20260921120000_artist_merge/migration.sql` 第23–37行定义的 `artist_merge_catalog_lock`，才取得 advisory creator catalog 锁 `7341902118`。本批调用链中未见在取得根协调之前显式调用 `lockCreatorCatalog`，运行时 `withFencedMutationTransaction` 也只先锁执行租约与任务行。

触发条件是另一事务已按既定顺序持有 creator catalog 并等待相同根协调。例如 `claimArtworkDedupScope` 在 `packages/pixishelf-db/src/artwork-dedup-claims.ts` 第327–336行先取得 catalog 再取得根。此时扫描持根等待 catalog，另一事务持 catalog 等待根，形成死锁；PostgreSQL 需要中止其中一个事务。根协调按 logicalRoot 协调，因此不要求双方处理同一作品。该反序违反契约中 catalog → 全部根 → 排序来源 → Artwork 的约定；事务回滚能避免部分提交，但不能消除正常并发下的失败。

建议在这些最终发布事务首次根/来源锁之前取得现有 creator catalog 锁，保留 fence、来源断言和 Artwork Claim 守卫。不能只在 publisher 内已经取得来源锁之后补调用。修复后以两事务受控屏障验证 catalog/根竞争，并同时覆盖 Pixiv 刷新/新建、本地新建与审计 Apply 的调用链。

这是静态可行动发现，**尚未实测复现死锁**。本轮只读确认授权隔离库中的实际 Artwork 触发器存在，没有启动双事务或任何零行 UPDATE 复现。Local 重扫是否会经间接依赖取得 catalog 未追完，不将其列为已证实的同类路径。

## 测试证据缺口与更正状态

实施者已发现原 HOLD 夹具只写 `status=HOLD`，没有非空 `ownerOperationId`，会先被数据库约束拒绝。异常又可被执行器转为任务 FAILED，因此原负例中仅凭 FAILED 不能证明真正跨过 HOLD。本轮阅读时测试正更正为合成 owner，REOPEN 清 owner；其更正后重跑结果尚未完成独立核对，不能沿用此前15/15作为本轮审查通过证据。

仍需核对的具体位置是 `scan.postgres.test.ts` 第89–104行、第124–147行：故障注入在数据库状态更新成功前已经设置 `sourceId` / `inputId`；随后只断言该 ID 已设置、任务失败及未发布，仍不足以排除注入语句本身失败。应在全部注入成功后设置独立完成标志，回读实际 status、owner 与 generation，并断言与来源拒绝对应的错误/诊断和阶段，以及冻结证明未刷新、inventory 身份/hash/lastSeen 未被错误推进。NULL 与 Local 负例也应核对具体拒绝原因。已将此缺口交给统筹者和实施者；**尚未复审后续测试修正，不声称缺口已关闭**。

## 已阅读内容与初步结果

本轮对照了 AGENTS、文档入口、claims-contracts 的已协商“扫描页与审计交接”边界和本批实施记录。静态阅读覆盖新增证明 helper、冻结与恢复页、Pixiv 处理/发布、Local 导入与重扫、审计观察/收尾、Apply 读取及提交的关键调用链，并读取必要 DB/runtime 依赖；没有扩大到并行归档主体或此前 content-reader 改动。

已看到新发现页在读内容前捕获、PROCESS_STORED_HASH 重新读取、unchanged 页断言全部候选、部分冻结行保留原证明及路径/序号/hash/stat 对照、Pixiv 精确 provider+PATH、本地单 DIRECTORY、发布前来源断言及已有 Artwork Claim 守卫，以及证明拒绝后的 inventory 写入抑制。这些是阅读所得，不是完整无缺陷结论；审计 MISSING 仍只形成报告且没有补造证明。

## 本轮执行与限制

唯一数据库执行为授权专库 `127.0.0.1:55432/dedup_executor_next` 的只读事务：确认数据库名、111条成功正式迁移、实际 Artwork 的 `artist_merge_catalog_lock` 触发器，以及当时 source-media 根协调查询为0行；显式 ROLLBACK。首次沙箱连接受限，随后获自动审核允许执行同一只读核对。没有数据库持久写入、迁移、夹具或媒体操作，无需恢复业务状态。

未启动拟议的双事务死锁复现；未独立运行 PostgreSQL/单元套件、类型检查、全量 build/test/lint、docs/diagrams 或规模验证。未完成逐文件散列固定、后续测试修正复审和记录检查，统筹交付时应明确补齐必要的最小验证。此前实施者的测试和类型检查只按其记录引用，不视为本 reviewer 已重新执行或全面认可。

DB groups 原语已独立审核，本轮仅看调用方使用；App Apply 的入队证明复制由独立审查负责。并行 Archive 主体、release/双向代次传播、URL drain、真实文件动作及部署验收不在本轮结论内。此前 native 文件基础复审的平台阻断保持原状，本轮没有重试、绕行或宣称通过。gate 3 继续关闭，记录已实施内容不等于去重整阶段完成。
