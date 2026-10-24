---
status: historical
scope: 去重第一阶段数据库、任务控制、离线恢复 CLI 与归档控制的独立代码审查
last-verified: 2026-10-23
sources:
  - packages/pixishelf-db/src/media-content-recovery.ts
  - packages/pixishelf-job-runtime/src/media-content-control.ts
  - packages/pixishelf/services/archive/archive-module.ts
  - packages/pixishelf/services/archive/archive-task-service.ts
  - packages/pixishelf-worker/src/media-content-recovery-cli.ts
---

# 第一阶段数据与控制审查

审查结论：**不通过，发现两项 P2，须修复并定向复审。** 本报告不修改功能源码，不代替 Executor 与 App 上传、替换、删除的独立审查。

## 版本、范围与环境

日期为 2026-10-23；工作区为 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，分支 `codex/artwork-deduplication`，基线及审查时 HEAD 为 `a4f4a031611d7cd646b0fc43618b2f0fdb5fe1d4`。审查对象包括未提交改动和未跟踪新文件；下列行号对应本次审查快照，后续修复可能改变行号。

核对了 AGENTS、文档入口、[阶段规格](../design/artwork-deduplication/01-fingerprints.md)、[共享契约](../design/artwork-deduplication/phase-1-contracts.md)、[恢复 runbook](../operations/runbooks/media-content-recovery.md)及工程、备份基线，并审查以下范围：

- DB：`schema.prisma`，`20261023002000`、`20261023003000` 两个迁移，所有 `src/media-content-*.ts`，导出及启动 schema 门禁。
- Runtime：`media-content-control.ts` 与 `queue-repository.ts` 本次取消和过期执行恢复改动。
- Worker：恢复命令解析、快照文件读写、真实 CLI、物理根复核与 build entry。
- App：`job-command-service.ts` 及归档取消、retry、cleanup 和新增 publication retry helper。

重点追踪了版本/epoch 单调失效、Image 触发器、目录祖先 generation、同根冲突与独立 PATH 发布、完整成员缓存、source token 精确范围、旧 attempt、父子收口、grant/resume/consume/revoke、取消回收审计与归档业务绑定。Executor 文件证明与指纹算法仅按依赖读取，没有重复整包审查。

最小复现使用现有隔离 PostgreSQL 的 `dedup_tests`，回环地址 `127.0.0.1:55432`，唯一 `review-data-control-*` 合成任务；没有媒体 I/O。死锁样本任务已按唯一 ID 删除；grant 样本在事务末整体回滚。未清理其他行。临时复现程序位于 `/private/tmp/pixishelf-data-control-review-repro.ts`，不属于交付源码。

## P2-DC01：归档取消与继续存在相反锁顺序

定位：[archive-module.ts](../../packages/pixishelf/services/archive/archive-module.ts) 401–405 行；同类入口为 [archive-task-service.ts](../../packages/pixishelf/services/archive/archive-task-service.ts) 186–200 行。底层 [media-content-control.ts](../../packages/pixishelf-job-runtime/src/media-content-control.ts) 7–13 行先取得 resource lease / job 行锁。

新增 CANCEL 路径先锁 resource/job，再等待归档 advisory lock `7341902117`。同一控制函数的 RESUME/PAUSE 仍先在 405 行取得 advisory lock，再于 442 行更新并锁定 job；批量版本对应 200 行及 331 行。一个 PAUSED 任务同时收到 CANCEL 与 RESUME，即可出现：

1. RESUME 持有 advisory lock，尚未更新 job。
2. CANCEL 持有 job 行锁，等待 advisory lock。
3. RESUME 更新同一 job，等待 CANCEL 的行锁。

隔离 PostgreSQL 用上述实际 helper 与相同 SQL 顺序稳定复现，结果为一方成功、一方 `Prisma P2010 / PostgreSQL 40P01`：

```text
Process 1364 waits for ExclusiveLock on advisory lock [19103,1,3046934821,1]; blocked by process 1363.
Process 1363 waits for ShareLock on transaction 10640; blocked by process 1364.
```

影响：合法的归档取消或继续操作可因死锁失败，批量入口可登记为 INTERNAL/FAILED；数据库会回滚受害事务，本次复现未造成媒体损坏。Worker 的原有 resource/job → publication coordination 顺序也与 App 的反向控制路径竞争。

最小修复：让同一归档控制范围内的 PAUSE、RESUME、CANCEL、RETRY 使用一致的 resource/job → coordination 顺序，锁后重新读取原绑定并保留状态 CAS。只调整新增 CANCEL 一侧为 coordination → job，会重新与 Worker fence 顺序冲突。

测试缺口：现有 PostgreSQL 控制测试验证单入口结果，没有用双事务屏障覆盖上述锁交错。新增定向并发测试须证明没有 40P01，且仅一个最终状态成功，另一方得到领域状态冲突；同时覆盖单项/批量入口与运行中 fence 的协调顺序。

## P2-DC02：grant 结果丢失后无法通过精确重放取回授权 ID

定位：[media-content-recovery.ts](../../packages/pixishelf-db/src/media-content-recovery.ts) 420–425 行。

当原 job/session 已有 ACTIVE grant 时，当前实现无条件返回 STALE，即使新请求的完整 snapshot、摘要、expected/target attempt、操作者及备份检查点均与原 grant 相同。隔离 fixture 对同一已核验输入连续调用实际 helper，得到：

```text
第一次：READY { grantId: <同一授权>, nextAttempt: 2 }
第二次：STALE
```

触发：grant 的数据库事务已经提交，但 CLI 进程在输出 grantId 前退出，或操作者丢失了输出。重新运行相同 grant 命令无法拿回原 ID。[CLI](../../packages/pixishelf-worker/src/media-content-recovery-cli.ts) 95–110、147–153 行只有 grant 的成功返回包含 ID；inspect 只导出内容快照和摘要，没有查询现存 grant 的能力，而 resume/revoke 都要求先提供 ID。因此文档中的恢复流程只能靠额外手工查询数据库才能继续，未闭合授权创建的幂等恢复。

最小修复：在现有停写、job/resource 锁与新快照 CAS 全部通过后，读取原 ACTIVE grant；只有完整原 snapshot/摘要、job/session、expected/target attempt、operator、backupCheckpointRef 全部精确相同，才返回同一个 grantId 与 nextAttempt，并且不新增授权或审计。任何元数据、版本、范围或状态变化仍拒绝，不能据原路径或相近快照认领授权。

测试缺口：增加跨事务的“第一次 grant 提交、丢弃返回值、精确重放”用例及真实 CLI 重放用例，断言同一 ID、单条 ACTIVE grant、单个 GRANTED 审计；分别修改 snapshot、operator、backupCheckpointRef 或 attempt 均须拒绝。当前复现使用同一回滚事务证明无条件拒绝分支，没有模拟真实进程在提交后退出。

## 已核对事项与验证限制

本范围其他已读路径未发现新的可确认阻塞缺陷。迁移延迟填充、不扫描媒体；Image 触发器按成员/path/size 变更失效；目录根锁、祖先 generation 与 owner 独立发布分工清楚；离线恢复重新核对原 job/session/source/scope、下一 attempt 和租约；过期 CANCELLING 有 gate 时转 PAUSED 并保留取消审计；归档原位 retry 与 cleanup 检查保留原业务绑定。上述结论是代码审查范围内的判断，不表示穷举并发或生产恢复验收。

本次未重复 DB/Runtime/App 全量测试或构建，未重新执行完整迁移链、真实 CLI 整链和浏览器场景；既有验证数字仅见[实施记录](./artwork-deduplication-phase-1-2026-10-23.md)，不作为本 reviewer 独立执行结果。Executor 正在修复的 pre-rename PUBLISH 恢复能力由其独立 reviewer 验证，本报告没有重复记作缺陷。修复这两项之后仍需按分工完成定向复审。

文档交付检查：`pnpm docs:check` 通过（193 个 Markdown）；`git diff --check` 通过；`rg --files packages/pixishelf | rg '[A-Z]'` 无匹配。图示检查默认启动因 Playwright bundled Chromium 缺失而失败，随后 `WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 通过（33 个图源、23 个内嵌 Mermaid）；未下载浏览器或更改图源。

## 定向复审：DC01 / DC02（2026-10-23）

复审结论：**通过；P2-DC01 与 P2-DC02 关闭。** 此结论仅覆盖上述两项修复及必要交界；前文首次审查的不通过结论保留为当时证据，不代表修复后的状态。没有修改功能源码，没有重新开展全域审查。

DC01：核对单项归档 `retryCentralArchiveImport`、`transitionCentralArchiveControl` 与批量 `applyTaskAction`。PAUSE、RESUME、CANCEL、RETRY 均先调用导出的 `lockContentControlJob` 取得 resource/job 行锁，再取得 publication coordination advisory lock，锁后重新读取原 job/import 绑定并保留状态 CAS；取消门禁仍在同一锁内执行。单项与批量并发、以及实际 runtime fence 竞争均已覆盖，原先的 coordination → job 交错不再出现在这些入口。

DC02：核对 `grantMediaContentRecovery` 412–444 行。所有重放仍先完成 fresh inspect 的全局停写锁、租约/心跳与完整现场快照 CAS，之后才查原 ACTIVE；规范 snapshot、摘要、job/session、expected/target attempt、operator、backupCheckpointRef 全部精确相同时返回原 grantId/nextAttempt，不新增授权或 GRANTED 审计。变更输入、已撤销/消费的旧检查点引用均被拒绝；显式新检查点可创建新授权行，保留旧授权终态。真实 CLI 每次 grant 仍核对物理根；共享契约与 runbook 已同步上述行为。

本 reviewer 独立重新执行的最小验证如下，均使用空闲专用 `dedup_tests` 和测试自身唯一 fixture，按顺序运行，未访问真实媒体：

| 复审目标                        | 定向命令                                                                                                                                                     | 实际结果                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| DC01 控制交错与 runtime fence   | `pnpm --filter @pixishelf/next exec vitest run services/archive/__tests__/archive-task-service.postgres.test.ts -t 'serializes concurrent\|orders .* PAUSE'` | 8 通过，36 项因名称过滤跳过；一次 APPLIED，其余 STATE_CONFLICT，无 40P01                                      |
| DC02 跨事务丢回执重放及变化拒绝 | `pnpm --filter @pixishelf/db exec vitest run src/__tests__/media-content-recovery.postgres.test.ts -t 'committed grant response\|rejects grant replay'`      | 14 通过，22 项因名称过滤跳过                                                                                  |
| DC02 真实 CLI 与原任务链路      | `pnpm --filter @pixishelf/worker exec vitest run src/__tests__/media-content-recovery.postgres.test.ts`                                                      | 1 通过；同 ID/单授权/单审计、根变化拒绝、撤销旧命令拒绝、新检查点新授权、原 job resume → 下一 attempt consume |

环境变量仅将测试连接定向至 `127.0.0.1:55432/dedup_tests`，没有加载生产连接。实现者的类型检查、单元测试与其他验证记录另行汇总，本 reviewer 未重复全量 test/build/typecheck、全局 docs/diagram 或浏览器检查；本次定向通过不代替阶段总验收及生产恢复演练。

## 追加窄复审：102 → 103 升级测试（2026-10-23）

结论：**通过，未发现阻塞问题。** 本次仅审查 `media-content-migration.postgres.test.ts` 69–252 行新增的恢复授权升级测试及其两个辅助函数，没有修改功能源码或重新运行其他检查。

新增两个用例分别以空库和有旧数据的独立 schema 为 fixture，实际应用 `20261023002000_media_content_fingerprints` 后冻结旧表，再应用磁盘上的正式 `20261023003000_media_content_recovery_grants` SQL。非空 fixture 覆盖旧 Artwork、Image、任务及六张内容证据表；迁移前后逐表按主键读取全部字段并深度比较，包含超过 JS 安全整数的 bigint、声明/source token、版本、状态与时间，因此没有仅验证计数或自造迁移结果。新增 grant 表在升级后为空。

约束验证执行真实 INSERT/UPDATE/DELETE，并按 PostgreSQL SQLSTATE 精确断言 CHECK（23514）、活动唯一键（23505）和 FK（23503）。覆盖合法默认 ACTIVE、非法 attempt/下一 attempt、空或超长字段、摘要大小写、非对象/超限快照、消费/撤销字段组合、同 job/session 活动冲突、不同 job/session 允许并存、父任务删除限制与 ID 更新级联；CONSUMED/REVOKED 历史保留后可创建新的 ACTIVE，也验证了部分唯一索引的状态边界。

隔离与自清理可靠：每个 schema 使用随机 UUID；`SET LOCAL search_path` 仅指向该 schema；建表、两次迁移、样本写入和全部约束尝试都处于同一事务。预期失败语句通过 savepoint 回滚后继续，最后抛出专用 sentinel 整体回滚，并在事务外确认 schema 不存在。断言或迁移中途失败同样使外层事务回滚，不依赖测试末尾的显式 DELETE；没有媒体 I/O 或对业务 schema 的清理。

已核对实施者提供的 `/tmp/pixishelf-migration103-20261023.log`：该文件共 4/4 通过，其中原 102 空/非空用例 2 项、新增 103 空/非空用例 2 项。按交付信息运行于专用 `dedup_content_tests`；本 reviewer 仅做代码及日志审查，没有独立重跑测试或单文件类型检查。此测试证明当前正式 SQL 在最小旧 schema fixture 上的保持性和约束，不替代完整 `migrate deploy` 链、生产副本升级或生产恢复演练。
