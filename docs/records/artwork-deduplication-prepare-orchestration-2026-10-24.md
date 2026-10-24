---
status: partial
scope: PREPARE 真实归档证据、Worker 编排与恢复入口小批
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/file-execution-contracts.md
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - packages/pixishelf-job-executors/src/artwork-dedup/maintenance-executor.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/maintenance-executor.postgres.test.ts
  - packages/pixishelf-worker/src/create-worker-executor-registry.ts
---

# PREPARE 编排小批交接

本批已完成受影响定向验证，待独立审查，不等于第三阶段发布验收。`ARTWORK_DEDUP_RELEASE_STAGE` 仍为 2，生产 PREPARE 在申请 reader 和媒体 I/O 前被门禁拒绝；ISOLATE/RESTORE/PURGE 和 PREPARE_PURGE 均未实现或开放。本轮没有执行原媒体写入、移动、删除，没有重新构建 Worker/App，也没有运行规模测试。

原文件写基础两项修复的独立复审仍因平台风险检查阻断，不得视为通过。原只读 PREPARE 批两项 P2 已修并交原 Sol 窄复核，具体证据见[原小批记录](./artwork-deduplication-prepare-executor-2026-10-24.md)；本记录只列新编排与归档用例。

## 实现范围

- 新 `artwork-dedup/maintenance-executor.ts` 注册 `ARTWORK_DEDUP_MAINTENANCE@1`，本批执行仅 PREPARE/ISOLATION。保持 BACKGROUND_WRITER、SYSTEM、priority 900 的既有契约。INVENTORY → INSPECT → VERIFY 保存阶段与 artwork 游标，内部媒体/来源/目录检查点沿用上一批。
- 每 slice 开始和结束复核完整冻结根映射及 archiveRelativePrefix；10 秒或 256 MiB 文件边界保存后真实 close、释放 reader，再 preserveAttempt/schedulingYield 冷却 3 秒。最多每 10 秒聚合进度，没有逐文件外部事件。
- 取消、暂停和失租约停止接受结果；关闭失败保留 token、BLOCKED 和 ACTION_REQUIRED。最后 completePrepare 与 scope.complete 同事务，快照变化得到 STALE，预览阻断保留明确状态。
- 新 `reader-latch.ts` 让 SCAN/维护共用全局持久 reader 搜索、固定身份探针、原 token CAS；租约到期本身不释放占用。新 `root-bindings.ts` 仅从 SCAN 等价提取原比较函数。`executor.ts` 对应改为调用两项共用逻辑。
- `artwork-dedup/index.ts` 导出维护 executor。Worker registry 为 SCAN/维护注入同一 DedupReaderSupervisor。注册、production-capabilities、capability-audit 及测试更新为 **39 job types / 47 versions，仍为三 lane**；能力注册不越过阶段门禁。
- 现有恢复入口增加 `--operation`，与 `--run` 严格互斥。直接调用数据线 inspect/recoverOperationReader；显式 stopped-writers 确认、实际停止核验与原 token/digest CAS 均由既有共享 helper 执行。没有 force 选项，没有在此实现新恢复框架。现有 build entry 已覆盖该文件，不需新增构建入口。

独占新测试：`maintenance-executor-fixture.ts`、`maintenance-executor.postgres.test.ts`、`maintenance-crash-fixture.ts`、`maintenance-archive.postgres.test.ts`。Worker 改动限定 registry、capabilities/audit、reader-recovery 实现与对应三份 tests。原批修复文件另见上一记录；数据/App/contracts 文件未由本线修改。

## 验证

全程只使用 `dedup_executor_next`（正式迁移 110）及自行创建的合成临时媒体。没有访问或更改真实媒体、`dedup_scale`、冻结基准代码和 `/tmp/dedup-scale-*`。

| 验证 | 结果 |
| --- | --- |
| 真实 DOWNLOAD → sealed/drained → PUBLISH → SCAN → PREPARE | 2/2 |
| 新 PREPARE 编排真实 PG＋reader | 10/10 |
| 新增真实 Worker 夹具 SIGKILL、退出证明与原游标续跑 | 1/1，另外10项跳过 |
| SCAN 受共享 helper 提取影响的 prefix 尾检、不变映射续跑、真实 SIGKILL | 3/3，另外22项跳过 |
| Worker executor registry / 共享 supervisor | 8/8 |
| Worker capability audit | 7/7 |
| run/operation 离线恢复参数 | 2/2 |
| Executor typecheck、Worker typecheck | 通过 |

归档 fixture 使用真实既有归档执行器，不手工伪造 sealed/drained 发布状态。pageIndex=7 用于确认对应实际 staged path；完整合法链可 READY，身份正确但 manifest 多一个换行使实际封印 SHA 不同则 BLOCKED。首次 afterAll 遇到测试自有 path-write FK；修正本夹具清理顺序并只清理精确失败 root 后重跑通过。

编排用例覆盖：真实生产门禁拒绝且不 spawn；完整只读预览原子完成；来源文件字节预算续跑不重复读取；10 秒媒体游标与聚合进度；PAUSING/CANCELLING 不接受当前页；成员变化 STALE；有效根映射改变首个文件前拒绝；旧租约不写结果；模拟丢失 close 确认后 ACTION_REQUIRED 保留，再独立探针证明退出才释放。

SIGKILL 用例运行独立 Worker 夹具进程，真实 claim 身份/租约、持久 readerOwner 和真实 child，提交 4 个媒体行后直接 SIGKILL，无 finally 清 token。到期恢复队列后，新 executor 通过固定探针证明旧 reader 已退出，继续同一 operation，最终10行。恢复仅做余下6个 inventory stat（目录阶段另核验10个登记文件和2个目录）；没有重读前4个 inventory。此项不是完整部署 Worker 二进制或真实 NAS 故障演练。

Worker 注册初次检查仅因能力数组排序失败，调整 MAINTENANCE 在 SCAN 前后只重跑 registry 8 项通过。类型首次发现新 progress 对象缺必填字段，补齐后两个受影响包均通过。没有因此重跑整套 App、数据库或归档测试。

## 复核与续接命令

```bash
QUEUE_KERNEL_TEST_DATABASE_URL='postgresql://dedup:dedup-fixture-only@127.0.0.1:55432/dedup_executor_next?connection_limit=20&pool_timeout=20' pnpm --filter @pixishelf/job-executors test src/artwork-dedup/__tests__/maintenance-executor.postgres.test.ts
QUEUE_KERNEL_TEST_DATABASE_URL='postgresql://dedup:dedup-fixture-only@127.0.0.1:55432/dedup_executor_next?connection_limit=20&pool_timeout=20' pnpm --filter @pixishelf/job-executors test src/artwork-dedup/__tests__/maintenance-archive.postgres.test.ts
pnpm --filter @pixishelf/worker test src/__tests__/executor-registry.test.ts src/__tests__/capability-audit.test.ts src/__tests__/artwork-dedup-reader-recovery.test.ts
```

限定单项时使用 `pnpm --filter @pixishelf/job-executors exec vitest run --config vitest.config.ts <file> -t '<pattern>'`，避免 pnpm test 消费 `-t` 参数。类型检查使用相应包 `typecheck`。续接仅在新改动或新问题需要时运行对应命令，复用本批已通过结果。

恢复 CLI 的新语法为 `inspect --operation <id>`，然后 `recover --operation <id> --expect <digest> --expected-reader-token <token> --operator <name> --confirm-all-writers-stopped`；执行前须按共享恢复契约停写并检查具体保留 reader。本文只记语法，没有对任何真实 operation 执行恢复。App PAUSED/BUILDING 继续与离线 helper 的 PG 证明由数据线记录；本批不重复其测试。

下一步先完成原 PREPARE 修复窄复核、新编排与数据恢复链独立审查，再决定第三阶段门禁与最终集成验收。未收到新授权前不开始隔离、恢复、purge 文件动作。
