---
status: record
scope: 归档来源证明实施中的安全暂停交接与扫描测试夹具验收更正
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-scan-sources-2026-10-24.md
  - docs/design/artwork-deduplication/archive-source-proofs.md
  - packages/pixishelf-job-executors/src/archive/dedup-source-snapshot.ts
  - packages/pixishelf-job-executors/src/archive/download-generation.ts
---

# 归档原来源证明暂停交接

用户选择“当前小批次收口后暂停”。本记录写入后停止扩展、验证与修复，等待用户主动恢复。全部修改保留在 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf` 的 `codex/artwork-deduplication`、HEAD `6e8d4f4c` 未提交工作区；未重置、提交或清理其他人的改动。没有仍运行的本线测试或自建进程，无待停 PID；没有停止用户的 5430 服务或真实服务。

## 扫描冻结批验收更正

冻结后归档真实 PG 测试发现，合成 HOLD 必须同时写非空 `ownerOperationId`；原扫描两个页读前负例与两个冻结后负例只写 status，数据库约束异常可能被 executor 捕获为失败，从而形成错误的 HOLD 验收证据。只修改 `packages/pixishelf-job-executors/src/scan/__tests__/scan.postgres.test.ts`，扫描生产文件保持冻结。

修正注入写入合成 owner，重新 OPEN 清 owner 并增加 generation；辅助函数读取原 generation、HOLD 提交状态及 OPEN 提交状态逐项断言。完成旗标只在注入与读回全部成功后设置，并在 executor 返回后断言，避免被被测逻辑吞掉注入错误。NULL 注入也读回并确认完成。unchanged 页改为真实 HOLD→OPEN 周期，并在成功后设置旗标。领域结果继续要求原 proof 不变、零 Artwork 发布、inventory 无处理/错误重绑定或整页完全不变。

修正首轮 12/15 通过，3 项只在更严格的来源文本断言失败：discovery/unchanged 页直接抛 DB `ArtworkDedupOperationError`，既有 lifecycle 将持久错误泛化为 `Scan execution failed unexpectedly`。生产诊断未修改。最终测试在原 fenced mutation 外捕获并断言确切 `SOURCE_HELD` / `SOURCE_GENERATION_CHANGED`，另断言持久 FAILED checkpoint 与领域零写入；冻结输入处理已有明确来源错误文本。

最终已启动验证在暂停消息到达前完成：2026-10-24 10:50:07 本地启动，3.88 秒结束，15/15 通过、54 skipped。过滤表达式为 `discovery proof capture|keeps frozen proof|unchanged discovery page|original LOCAL_DIRECTORY|recovers observed inputs after a crash|applies frozen NEW evidence|applies CHANGED evidence|marks newly published Pixiv|builds a trusted baseline|classifies all audit differences`。这是实际复验结果，替代此前 HOLD 夹具的错误证据。主线静态复审报告的根→catalog 反序仍待修；本线未处理生产审查发现。

## 归档已经落盘的实现

- 严格单 PROVIDER 原证明 parse/assert；不捕获或刷新来源。导出 `parseArchiveSourceSnapshot` / `assertArchiveSourceSnapshot` 给 App 后续 retry 守卫消费。
- RESOLVE 纯 URL identifySource 后、网络前检查原 proof，最终 fenced 事务再检查并要求解析身份及当前持久 proof 与原 proof 一致；来源错误可留下原任务失败回执。
- ENQUEUE/AUTO、已有 ENQUEUED、活动 Import 复用与唯一键 race 恢复检查原 Intake/Import proof；新 Import 复制 Intake proof。
- DOWNLOAD 启动在原 fence 中核验并登记 `ArchiveStagingGeneration` 后再首次 staging 文件动作；每个下载/复制单元及成功媒体收据检查原 proof 和当前执行 token；实际 I/O 结束后先记录本 token 的 drain，再进行受 proof 限制的阶段交接。失败/控制/drain 不要求来源 OPEN。
- PUBLISH begin、最终发布及已落盘恢复增加 catalog/root/source 前置锁链和原 proof 校验；现有 Artwork CONTENT 守卫、封存与 media write 令牌约束保留。已落盘恢复不补来源 proof。

实现尚未独立审查，尚未宣告归档批完成。普通维护 URL hold/drain 聚合、App retry 后续守卫、真实 ISOLATE/RESTORE/PURGE 均不在本批已完成范围；gate 维持 3。

### 精确本线文件

生产：

- `packages/pixishelf-job-executors/src/archive/dedup-source-snapshot.ts`（新）
- `packages/pixishelf-job-executors/src/archive/download-generation.ts`（新；从 executor 提取下载代准备/drain）
- `packages/pixishelf-job-executors/src/archive/executor.ts`
- `packages/pixishelf-job-executors/src/archive/index.ts`
- `packages/pixishelf-job-executors/src/archive/intake-enqueue.ts`
- `packages/pixishelf-job-executors/src/archive/media-content-publication.ts`
- `packages/pixishelf-job-executors/src/archive/phase-handoff.ts`
- `packages/pixishelf-job-executors/src/archive/provider-governor.ts`（纯 identifySource 委托）
- `packages/pixishelf-job-executors/src/archive/publisher.ts`
- `packages/pixishelf-job-executors/src/archive/resolver-executor.ts`

测试：`archive/__tests__/dedup-source-fixture.ts`（新）、`dedup-source-snapshot.test.ts`（新、尚未运行）、`download-lane.postgres.test.ts`、`download-lane-recovery.postgres.test.ts`、`resolver-executor.postgres.test.ts`。必填 provider 接口兼容夹具另改 `executor.test.ts`、`provider-governor.test.ts`、`provider-governor.postgres.test.ts`、`resolver-executor.test.ts`、`uploader-scan-executor.test.ts`。上述路径均在 `packages/pixishelf-job-executors/src/archive/` 下。扫描更正仅前述 `scan.postgres.test.ts`。

文档：`docs/design/artwork-deduplication/archive-source-proofs.md`（新草案）、本记录、扫描批记录的更正链接。没有修改 App 拥有的 archive types、E-Hentai provider、URL parser 或其测试；也没有修改公共 DB/contracts。

## 已跑验证与限制

唯一数据库为正式迁移 111 的 `dedup_executor_next`：`postgresql://dedup:dedup-fixture-only@127.0.0.1:55432/dedup_executor_next`，没有 db:push 或其他数据库迁移。

归档三文件定向 PG 最后一次结果 17/17 通过、39 skipped，3.98 秒。过滤表达式：`original source|original resolver|original drain|original fenced|source generation changes at final|handoff and replay|reuses checked completed|recovers a rename-before-commit|does not drain or allow same-generation|atomically commits READY|commits AUTO NEW`。覆盖 NULL/HOLD/REOPEN 启动拒绝且零 staging/network、首次 mkdir 前执行代已登记、流中来源变化拒绝成功收据且原 token drain、manifest 尚未结束不能 drain、HOLD 下阶段交接拒绝和暂停 drain、最终发布代次拒绝、正常 handoff/恢复、解析前 null 与网络后换代拒绝、AUTO 新 Import 原 proof 相同。

归档最初一次跑到 fixture cleanup 模型名称错误，随后修正；第二次的 HOLD 夹具缺 owner 失败，已按真实 schema 修正后才得到 17/17。没有降低数据库约束。

归档早期包 typecheck 通过，但最后的 `finalizeResolved` 改为参数对象、移除下载代 helper 未使用 now、移除 executor 未使用 helper 与新 pure 单测在该次通过之后落盘，尚未再次类型检查或测试。17 项 PG 也在这些最后小改动之前运行。不能将此前 typecheck/PG 通过当作最新完整工作树通过。

定向 oxlint 已运行并报告 23 errors、2 warnings；包括 multiline curly、新增签名触发参数数量、以及既有 max-params / executor max-lines。最后只改了新增 finalizeResolved 参数对象、移除未使用值，未再次 lint，也尚未自动修复 curly。executor 现文件约 1322 行，HEAD 原为 1407 行，仍超过 1200 规则。没有执行全量 build/test、规模验证、docs 或 diagrams 复验。

## 恢复顺序和命令

仅在用户明确恢复后继续：先读主线暂停交接与独立扫描审查，解决根→catalog 反序及约定的生产诊断问题；保留本次测试的注入成功证据。归档需独立静态复审源锁顺序、原 proof 传递、控制回执和 current/import 绑定，再修复 lint、跑包类型及本文精确定向用例。新单测尚待运行；旧大型 resolver/intake/mock fixtures 仍有未升级 proof/URL identity 的部分，不可批量补生产旧意图。

恢复测试示例（本记录不执行）：

```bash
cd /Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf
pnpm --filter @pixishelf/job-executors typecheck
QUEUE_KERNEL_TEST_DATABASE_URL='postgresql://dedup:dedup-fixture-only@127.0.0.1:55432/dedup_executor_next' pnpm --filter @pixishelf/job-executors exec vitest run src/archive/__tests__/dedup-source-snapshot.test.ts
QUEUE_KERNEL_TEST_DATABASE_URL='postgresql://dedup:dedup-fixture-only@127.0.0.1:55432/dedup_executor_next' pnpm --filter @pixishelf/job-executors exec vitest run src/archive/__tests__/download-lane.postgres.test.ts src/archive/__tests__/download-lane-recovery.postgres.test.ts src/archive/__tests__/resolver-executor.postgres.test.ts -t 'original source|original resolver|original drain|original fenced|source generation changes at final|handoff and replay|reuses checked completed|recovers a rename-before-commit|does not drain or allow same-generation|atomically commits READY|commits AUTO NEW' --reporter=dot
```

停工恢复依据仍为扫描记录中的正式 111 迁移及迁移前 dump；本批未再次迁移。dump `/private/tmp/dedup-executor-next-before-111-20261024.dump`，SHA256 `92b727a0b177e77a2ab4293dc3fd0b0c4bedab7a73b5608a5867b592c4fc9765`，未声称验证恢复可用。
