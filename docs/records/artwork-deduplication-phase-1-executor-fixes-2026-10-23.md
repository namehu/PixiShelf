---
status: historical
scope: 去重第一阶段 Executor 独立审查五项修复与定向故障验证
last-verified: 2026-10-23
sources:
  - packages/pixishelf-job-executors/src/migration/executor.ts
  - packages/pixishelf-job-executors/src/scan/media-content-write.ts
  - packages/pixishelf-job-executors/src/scan/media-content-recovery.ts
  - packages/pixishelf-job-executors/src/archive/executor.ts
  - packages/pixishelf-job-executors/src/archive/maintenance-executor.ts
  - packages/pixishelf-job-executors/src/scan/__tests__/media-content-recovery.postgres.test.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/download-lane.postgres.test.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/maintenance-executor.test.ts
  - packages/pixishelf-job-executors/src/archive/__tests__/maintenance-executor.postgres.test.ts
  - packages/pixishelf-job-executors/src/scan/__tests__/media-content-recovery.test.ts
---

# Executor 审查修复证据

日期：2026-10-23。工作树为 `artwork-deduplication/PixiShelf`，分支 `codex/artwork-deduplication`，HEAD/base 为 `a4f4a031`。本记录对应未提交修改，不代表生产上线。主工作目录未修改，未执行 Git 提交。

修复依据为[独立审查记录](./artwork-deduplication-phase-1-executor-review-2026-10-23.md)。该审查记录保留当时结论；本记录说明修复和实施者验证，独立窄复审结论另由原审查者提供。

## 五项修复

| 审查项                        | 修复                                                                                                                                                                                                                                                                                       | 故障证据                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01 SKIPPED 两事务          | 同路径迁移在一个 fenced mutation 内完成 `publishArtwork(SKIPPED)` 和 `finishContentWrite`。                                                                                                                                                                                                | 真实 PG 成功路径同时终结 item 与声明；在 SKIPPED DML 后、finish 前抛错，整个事务回滚，原检查点与 ACTIVE gate 保留，授权恢复后同一路径成功。                                                                                                                                                       |
| P1-02 持 gate 失败不可恢复    | 已取得写声明的 PermanentError 不再进入 FAILED/继续后续作品。末 attempt 和其他未验证收口的写错误保留 file checkpoint，转 ACTION_REQUIRED；正常取消仍先按现有证明收口。                                                                                                                      | 真实 PG 分别注入 begin 后源缺失、copy 完成后 PermanentError、末 attempt EIO。原 job/item 均可 inspect/grant/resume/consume，补足故障条件后完成原精确清单；旧 owner 的 finish 被拒绝。                                                                                                             |
| P1-03 CLEAN_STAGING 销毁证明  | CLEAN_STAGING 初检与最终清绑定都在发布协调锁内拒绝原 job 或原 `archive-publish:<importId>` session 的未终结声明。RECONCILE 跳过并记录恢复原因。PUBLISH 建立声明也在同锁内重检 cleanup 意图，关闭检查与建 claim 的窗口。                                                                    | 真实 PG 构造 rename 后/DML 前失败；直接 cleanup 被拒绝，RECONCILE 不排清理。final manifest、import 绑定、声明 owner/version 均保持，随后原 PUBLISH 的专用 postrename 交接可完成。App 请求入口由 control agent 同步修复并单独验证，本记录不重复计数。                                              |
| P1-04 rename 前无恢复入口     | 按[共享契约](../design/artwork-deduplication/phase-1-contracts.md)新增 ARCHIVE_PUBLISH 离线域快照，绑定原 import/job/execution/generation/manifest/Artwork；复用精确范围 grant 消费。begin 使用注入的 runtime clock。postrename 专用自动交接仍要求完整 final 与 staging 不存在且仅做 DML。 | 真实 PG 覆盖 durable gate 后进程中断模拟、rename ENOSPC、rename 前 CANCELLING；普通新 attempt 被拒绝，显式 grant 后通过 `resumeGrantedMediaContentRecovery` 同步原 job/import 排队并完成。取消到期的 queue/import 均 PAUSED；旧 execution 不能发布。保留原 postrename 零网络/零媒体 rehash 回归。 |
| P2-01 51 revisions 超声明上限 | 规范 archive revision 路径归并到该来源作品的 `sources/<provider>/<bucket>/<externalId>/revisions`，trash 路径归并到 `.trash/archive/<artworkId>`。FS 操作仍逐条使用原 revision 清单，不提高共享 100 scope 限制。                                                                           | 50、51 revisions 两个参数用例分别真实执行 trash/restore/purge，均只有两个目录声明；所有目标文件符合原清单，另一来源作品与另一 artwork 的哨兵文件保留。                                                                                                                                            |

## 实际验证

使用专用隔离 PostgreSQL 数据库 `dedup_executor_tests`（103 个迁移已部署）和测试创建的临时媒体目录。未访问真实媒体、生产数据库或外部原站。

首批通过 **17 个不同定向用例：7 个单元/临时文件系统用例、10 个真实 PostgreSQL 用例**。101 revisions 阻塞的补修另外通过 **7 个新用例：3 个分页单元用例、4 个真实 PostgreSQL 用例**；合计 24 个不同用例。选择器排除的既有用例未重跑，不能计为通过。没有重跑先前 133 个测试集合，没有执行全量测试或 build。

主要命令在 `packages/pixishelf-job-executors` 执行：

```bash
pnpm exec vitest run --config vitest.config.ts \
  src/archive/__tests__/maintenance-executor.test.ts \
  -t 'bounds maintenance|refuses cleanup'

pnpm exec vitest run --config vitest.config.ts \
  src/migration/__tests__/executor.test.ts \
  src/archive/__tests__/maintenance-executor.test.ts \
  -t 'actual failing file|all-canonical|non-completed file|bounds maintenance|refuses cleanup|removes staging'

QUEUE_KERNEL_TEST_DATABASE_URL='<isolated-fixture-url>' pnpm exec vitest run \
  --config vitest.config.ts --no-file-parallelism \
  src/scan/__tests__/media-content-recovery.postgres.test.ts \
  src/archive/__tests__/download-lane.postgres.test.ts \
  -t 'keeps migration claims|exact pre-rename|preserves unresolved post-rename|recovers a rename-before-commit'

pnpm typecheck
```

迭代只重跑失败的对应选择器：SKIPPED finish 故障、pre-rename 三种故障和永久错误旧预期。首次 PG 暴露 runtime clock 与壁钟不一致、RETRY_WAIT 不能直接离线 inspect 的衔接问题，现已修复；最终版本断言同时计算 grant 消费和终结各一次的声明版本推进。永久错误旧单测改为验证保留检查点，未删除故障断言。

最终类型检查首次仅报新增测试回调缺少类型标注，补标注后纠正性复核通过。`git diff --check` 与主应用路径大写检查无输出。文档链接与图示检查由主 agent 合并全部记录后统一执行。

## 101 revisions 阻塞补修

原 Sol 窄复审确认四项 P1 已闭合，但指出 51 revisions 的声明归并仍未解决 reader 对 100 revisions 的硬上限：101 个有效版本可进入文件写入，却不能取得恢复授权。本轮将此视为阻塞修复，不作为支持限制。

先更新共享契约的维护恢复段，再将 `readExecutorMediaRecoveryDomainSnapshot` 的 revision 数组改为版本化摘要。按 ID 升序 keyset 分页，每页最多 100 条，仅选择 `id/archivePath/trashPath/trashedAt/purgeAfter`；每行规范 JSON 使用 UTF-8 字节长度前缀送入 SHA-256，带固定域与版本。分页间只保留游标、hash 状态和 bigint count。返回 `{ version: 1, count: 十进制字符串, sha256 }`，不累计、截断全部 revision，未提高共享声明上限，也未修改维护 FS 的原精确清单、DB/schema 或 grant 存储。

新增证据：

- 100、101、200 三个分页边界单元用例确认每次查询 `take: 100`、稳定 ID 游标、无 offset，摘要含精确全部计数且返回体有界；末项变化和追加行均改变摘要。
- 三个真实 PG 用例分别给 TRASH_ARCHIVE / RESTORE_ARCHIVE / PURGE_ARCHIVE 建立 101 个真实版本目录，在全部文件工作完成、业务最终事务前注入失败。停写后同一原 job 完成 inspect → grant → `resumeGrantedMediaContentRecovery` → 新 attempt 消费 → 全部精确清单完成。每次仍仅两个声明，原 writeToken/source epoch 保持，授权只消费一次；旧 owner 不能终结新声明。逐一核对 101 个目标文件/删除结果和另一来源作品、另一 artwork 的哨兵文件。
- 一个真实 PG 用例依次改变 ID 排序第 101 项的 archivePath、purgeAfter、trashPath，分别验证 confirm 返回 STALE、resume 返回 STALE、Executor consume 被拒并以 ACTION_REQUIRED 暂停。原声明 owner/version、source、ACTIVE grant 及全部 101 个现有文件和哨兵均保持。

本轮只执行以下新增选择器；初跑六项通过，漂移用例因测试误读暂停原因的字段位置失败，修正为 runtime 的持久事件 `data.reason` / `data.data.errorCode` 后仅重跑该一项并通过。没有据此改动业务实现。最终 `pnpm typecheck` 一次通过，`git diff --check` 与主应用路径大写检查无输出。

```bash
QUEUE_KERNEL_TEST_DATABASE_URL='<isolated-fixture-url>' pnpm exec vitest run \
  --config vitest.config.ts \
  src/scan/__tests__/media-content-recovery.test.ts \
  src/archive/__tests__/maintenance-executor.postgres.test.ts \
  -t 'streams every one|all 101 revisions|101st revision'

QUEUE_KERNEL_TEST_DATABASE_URL='<isolated-fixture-url>' pnpm exec vitest run \
  --config vitest.config.ts \
  src/archive/__tests__/maintenance-executor.postgres.test.ts -t '101st revision'

pnpm typecheck
```

本轮未重跑之前的 17 项或其他全集，未重跑文档/图示全检查。独立审查者尚需对这次 reader 与对应测试进行最后窄复审。

## 限制

这是抛错/租约到期模拟与真实数据库、临时文件系统验证，未执行真实跨进程 kill、实际磁盘 ENOSPC、生产停写恢复或浏览器 D1-B01。App 全量 lint/test/build、真实 ffmpeg/ffprobe 和生产迁移未在本批运行。

所有在线受控写入口须遵守内容 gate；任意外部 SQL 或媒体写进程不在在线并发保证内。离线授权仍要求所有写者停止及完整备份检查点。未登记 target、残缺 staging 或未知文件不能借取消或清理解除保护。维护恢复 reader 已取消 revision 总数上限；本轮真实 PG 覆盖 101 个版本，单元分页覆盖至 200 个版本，未执行超大规模数据压力测试。
