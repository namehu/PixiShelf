---
status: historical
scope: 去重第二阶段数据、契约、App API、任务控制及 reader 离线恢复的独立代码审查
last-verified: 2026-10-23
sources:
  - packages/pixishelf-db/src/artwork-dedup.ts
  - packages/pixishelf-db/src/artwork-dedup-reader-recovery.ts
  - packages/pixishelf/services/artwork-dedup-service.ts
  - packages/pixishelf-job-runtime/src/queue-repository.ts
  - docs/design/artwork-deduplication/phase-2-contracts.md
---

# 第二阶段数据与控制独立审查

首次审查结论：**不通过；确认一项 P2，修复并定向复审后再通过本范围门槛。** 审查者未参与第二阶段实施；未修改业务代码、正式测试或提交。此结论只覆盖本报告列出的阶段 2 范围，不代替 Executor/reader 运行、资源验收或最终浏览器验收。

## 版本、范围与证据

审查日期为 2026-10-23，工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，基线及审查时 HEAD 为 `9c0f23bcbcda1373d7a6f9b9e6e8d564309ca4aa`。对象为相对该基线的未提交阶段 2 修改及未跟踪新文件；没有重新审查阶段 1 的整体差异。行号对应首次审查快照，修复后可能变化。

已对齐 AGENTS、文档入口、[总计划](../design/artwork-deduplication.md)、[阶段 2 规格](../design/artwork-deduplication/02-detection.md)、[实施契约](../design/artwork-deduplication/phase-2-contracts.md)及[实施验证记录](./artwork-deduplication-phase-2-data-2026-10-23.md)。审查范围如下：

- DB：Prisma 新增检测表，04000、04100、04200 三个迁移，`artwork-dedup.ts`、`artwork-dedup-reader-recovery.ts`，导出及最新迁移启动门禁；`media-content-recovery.ts` 仅审本阶段抽出共享停写检查的改动及调用边界。
- Contracts/Runtime：检测类型、payload/输入/DTO，SYSTEM/900/writer lane，通用创建、子任务、取消、重试与 aging 的领域保护。
- App：`artwork-dedup-service.ts`、受保护 router 和共享 router 挂接，账户一致性、实例共享事实、分页脱敏、控制 CAS/幂等、原冻结范围 retry、通用后台命令拒绝绕过。
- Worker：reader 离线恢复 helper、解析器、真实命令入口及构建入口。读取 executor 的最终调用处仅为确认 helper 的事务边界；进程身份自动退出证明、流水线与 reader 本体由另一独立 reviewer 负责。

实施者登记的 21 项定向测试及类型/lint 结果按原记录复用，未标为本 reviewer 重新执行。只针对下述实际疑点增加临时最小复现，没有重跑整个 21 项、全量 test/build 或浏览器。

## P2-D201：最终复核后仍可在完成提交前发布已经失效的重复组

**级别：P2，阶段正确性阻塞。** 此阶段尚不执行清理，本次没有媒体损坏；但完成结果可以包含在完成前已经失效的证据，违反最终 GROUP 与完成发布的同事务有效性要求。

定位：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-db/src/artwork-dedup.ts:272`–285；后续建组为同文件 289–304。调用方在 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/src/artwork-dedup/executor.ts:319`–324 同一 fenced 事务内调用该 helper 后执行 `scope.complete`，没有补充内容或归属锁。

最终校验语句只更新 `ArtworkDedupItem`；`EXISTS` 内对 Artwork、ArtworkContentSource、ArtworkContentFingerprint 和有效艺术家归属均为普通 MVCC 读取。通过校验的 COMPLETE 项没有被锁定其内容源/作品，因此校验语句结束后、规范多重集合分组及完成提交之前，其他 App 写入事务仍可更新 Image、使内容源 revision 推进并提交。后续分组只读取保存的 Item/Media，不再复核当前源。外层 run/job/lease 锁只能保护执行所有权，不能串行化这些内容变更。

独立复现调用实际 `buildArtworkDedupGroups`，在其第一条最终校验 SQL 执行完后设置双事务屏障。另一个事务用实际 `Image.update(path)` 及正式数据库触发器修改同一作品，提交后才放行分组和同事务的任务完成更新。结果为：

```text
sourceRevisionBefore: 1
sourceRevisionAfter:  2
finalStatus:         COMPLETED
publishedGroups:     1
changedArtworks:     0
```

两件作品原先有相同的完整合成证据；其中一件在最终校验后已经失效，却仍参加完成组。该交错不需要伪造账户、错误 payload、失租约或绕过队列优先级。受控 App 内容写入并不完全受 writer lane 串行保护。有效归属/艺术家合并的并发读取也应在同一修复中按已有创作者协调协议处理，避免修内容时留下同类窗口。

最小修复：在最终复核前按现有内容/创作者协议建立确定顺序的协调锁，持有至 `scope.complete` 的事务实际提交，再执行当前有效性检查与建组。作品内容行锁须覆盖全部待发布 COMPLETE 项、使用有序 SQL/分页或既有有界模式，避免把媒体全集搬进 Worker，也不能在事务中访问文件。若写入先取得锁，最终复核应将失效项转 CHANGED；若检测先取得锁，写入须等完成提交后再失效。修复应核对与既有 resource/job、目录、作品和创作者锁序一致，不能引入反向锁序。

测试缺口：已有 DB 测试只在进入最终 helper 前修改源版本，没有覆盖“最终检查结束、完成事务提交前”的写入。新增双事务屏障测试应覆盖源/成员变更与有效归属变化，断言写入被串行化或失效项被排除、完整组计数正确、无死锁；同时保留完成与数据提交的执行 fence CAS。

## 本次最小验证与限制

仅使用任务专用 PostgreSQL `127.0.0.1:55432/dedup_tests`，唯一前缀 `review-data-stage2-<uuid>` 的合成艺术家、作品、Image、检测和任务。没有访问真实媒体、执行器库、浏览器业务库或 `dedup_scale`。测试 `finally` 按本次 ID 删除自身 fixture，未清理其他任务/行。

临时复现位于 `/private/tmp/dedup-stage2-data-review-sol/review.test.ts`，配置为同目录 `vitest.config.mts`；通过 `pnpm --filter @pixishelf/db exec vitest run --config /private/tmp/dedup-stage2-data-review-sol/vitest.config.mts` 独立运行 **1/1 通过**。该通过表示断言确认上述缺陷可复现，不能表述为功能验收通过。测试注入只暂停 helper SQL 之间的时序，未更改正式实现。

其余已读范围未发现新的可确认阻塞：同艺术家活动唯一涵盖 PAUSED；冻结范围、审计操作者与 Session 分工清楚；retry 保留原 ID/根绑定并提高执行版本；通用命令及数据库策略维持 SYSTEM/900；持久 reader 占用不因租约过期清除；离线恢复复用三通道停写检查，重新检查原任务身份，绑定 run/execution 版本、原 token 与 inspect 摘要，同事务保留审计，且不修改源 gate。上述是本次代码审查判断，不代表穷举故障或生产恢复演练。

文档交付检查：`pnpm docs:check` 通过（202 个 Markdown）；`git diff --check` 通过；主应用普通路径大小写检查无匹配。图源和 SVG 未改，本 reviewer 不重复缺失默认 Playwright 的检查，也不将此前 Chrome 图示验证记作本次独立运行。浏览器按用户门槛留最终统一验收。

## 定向复审：P2-D201（2026-10-23）

复审结论：**通过；P2-D201 关闭，本报告数据与控制审查范围通过。** 首次 finding 与复现保留为修复前证据。本次只审修复及直接交界，没有重新审查整个阶段，没有修改实现、正式测试或提交；Executor/reader 其他项目及最终浏览器仍由各自阶段记录说明。

已核对 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-db/src/artwork-dedup.ts:270`–280：在既有 resource/job fence 与 run 锁之后，复用 `lockCreatorCatalog`，再通过数据库内按 Artwork ID 升序的 `FOR UPDATE OF a` 锁住本 run 所有 COMPLETE 项对应的作品。外层仅返回计数，没有把全部 ID/媒体放入 Worker。该事务随后重新查询源版本、epoch、完整指纹与有效归属、建组，并由原 executor 在同一 `finalizeInTransaction` 中调用 `scope.complete`；runtime 在回调后再次执行真实 lease/job fence CAS，提交或整体回滚后才释放全部锁。

锁序与本缺陷相关的既有路径一致：创作者编辑/合并及业务发布先取得 `lockCreatorCatalog` 创作者目录锁，再写作品；内容源 API 和 Image INSERT/UPDATE/DELETE 的正式触发器在推进 ArtworkContentSource 前均锁 Artwork。owner publication 在业务回调外层取得物理媒体目录/pathWrite 锁。新 GROUP 路径不再取得物理目录、pathWrite 或 Image 行锁，后续证据查询均为普通读取，因此没有引入 Artwork → 物理目录/Image 的反向等待。若写入先提交，锁后的下一条校验语句读取新快照并排除失效项；若检测先锁，内容/有效归属变化须等完成提交后才能发生，原先的校验后提交前窗口已关闭。

新增 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-runtime/src/__tests__/artwork-dedup-publication.postgres.test.ts` 通过实际 `PostgresQueueRepository.withFencedExecutionTransaction` 调用 helper 和 `scope.complete`，没有 mock 完成提交。复核了全部七个用例及实施者 `/tmp/dedup-d201-publication-test.log` 的 7/7 结果：Image 路径更新、Image 删除、真实 `editArtworkCreators(..., REMOVE)` 各自覆盖检测先锁和写入先锁两种交错；用 `pg_blocking_pids` 证明等待关系，检测先锁用例要求写入完成后能读到已提交的 COMPLETED，写入先锁用例要求失效项 CHANGED、组/成员为零。最终 lease 过期用例使用真实 runtime 时钟及围栏，验证所有组、DONE 状态和完成意图回滚，并通过后续创作者/源写入确认锁已释放。源/成员变更经过正式数据库触发器，并非直接改合成 revision。

本 reviewer 独立运行的最小范围为：

```bash
pnpm --filter @pixishelf/job-runtime exec vitest run \
  src/__tests__/artwork-dedup-publication.postgres.test.ts \
  -t 'holds source changes|actual final fence'
```

结果 **2 通过、5 因名称过滤跳过**，分别确认原始源写入窗口被阻塞至真实完成提交，以及最终失 fence 时发布整体回滚。使用专用 `127.0.0.1:55432/dedup_tests`，测试自身唯一 `dedup-publish-<uuid>` fixture 按 ID 清理；没有访问媒体、浏览器/执行器数据库或规模库。其余五项并发用例、既有 DB 6/6 及 DB/runtime 类型检查复用实施记录与已核对日志，未重复运行。此窄复审未发现剩余阻塞。

复审报告交付检查：`pnpm docs:check` 通过（205 个 Markdown）；`git diff --check` 通过。未重跑全量测试、构建、图示或浏览器。
