---
status: historical
scope: PREPARE Worker 编排、共享 reader 占用、SCAN 等价提取及恢复 CLI 独立审查
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-prepare-orchestration-2026-10-24.md
  - docs/design/artwork-deduplication/phase-3-contracts.md
  - docs/design/artwork-deduplication/file-execution-contracts.md
  - packages/pixishelf-job-executors/src/artwork-dedup/maintenance-executor.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/reader-latch.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/root-bindings.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/executor.ts
  - packages/pixishelf-worker/src/create-worker-executor-registry.ts
  - packages/pixishelf-worker/src/artwork-dedup-reader-recovery.ts
  - packages/pixishelf-worker/src/artwork-dedup-reader-recovery-cli.ts
---

# PREPARE 编排独立审查

2026-10-24，分支 `codex/artwork-deduplication`，HEAD `6e8d4f4c98514c96233404e02acb241f0a1be20f`，对象为该 HEAD 上尚未提交的新编排差异。审查在 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf` 的独立 GPT-6.1 Sol/xhigh 上下文进行，没有修改产品代码或他人的未提交文件。

本次限定范围内未发现可确认的 P1/P2 或其他需实现者修复的问题。此结论是限定代码审查结果，不构成完整第三阶段验收；`ARTWORK_DEDUP_RELEASE_STAGE` 仍为 2。

## 范围与方法

依据[编排交接记录](./artwork-deduplication-prepare-orchestration-2026-10-24.md)，审查 `maintenance-executor.ts`、共享 `reader-latch.ts` / `root-bindings.ts`、SCAN 中两处对应提取、Worker registry / capabilities / audit / reader recovery CLI 以及新增或修改的相关测试。阅读真实归档夹具如何取得 DOWNLOAD → sealed/drained → PUBLISH → SCAN 证据，但没有独立重跑该 PostgreSQL 链。

先阅读 AGENTS、文档入口、文档维护/测试策略、阶段三与文件执行契约及[原 PREPARE 审查记录](./artwork-deduplication-prepare-review-2026-10-24.md)。为判断调用方的约束，窄读 operation reader claim/release、execution/checkpoint、最终 complete helper 和 runtime fenced finalizer；没有重新审计全部数据/来源/目录实现。

原只读 PREPARE 两项 P2 以既有修复窄复审结论为准，本次不重复审查。`maintenance-files.ts`、native、能力探针、移动/删除实现与曾被平台阻断的文件写基础复审完全不在范围内，没有重试其验证，也不能由本结论替代其门禁。

## 已核对的编排边界

- **门禁与任务身份**：`maintenance-executor.ts:90–100` 先验证当前 operation/job/execution，再调用共享阶段门禁；仅接受 PREPARE/ISOLATION，拒绝发生在 reader claim、supervisor create 和媒体请求前。注册能力不会提升阶段常量，也没有增加 ISOLATE/RESTORE/PURGE 或 PREPARE/PURGE 的执行路径。
- **reader 生命周期**：`:99–131` 先对既有占用执行固定身份退出证明，再持久 claim、创建 child、记录 owner，之后才解析媒体根。`:184–210` 尾检根映射，等待 progress 并实际 close，随后单独事务按原 operation/job/execution/token CAS 释放；此清占用事务不发布业务结果，允许在已失租约但已关闭时清自己的 token。close 不确认时传 `blocked:true` 保留 token，`:221–229` 转 ACTION_REQUIRED，取消中则拒绝按成功关闭终结。
- **全局共享占用**：`reader-latch.ts:11–32` 同时搜索 SCAN/维护占用；缺少 job/token/有效 owner 或未取得退出证明均拒绝，证明后按 kind 选择对应 release helper，保留原 executionVersion 与 readerToken。读者到期不被当作退出。DB claim 在既有全局协调锁下检查两类占用，实际 release helper 仍核对原身份与 token；共享函数没有引入 force 清除。
- **预算和恢复检查点**：`:145–183` 使用共享 10 秒/256 MiB 上限和 reader 实际累计字节；INVENTORY、INSPECT 与 VERIFY 推进持久 stage/artwork 游标，内部媒体、来源和目录检查点仍由既有 pipeline 的围栏事务保存。完成文件边界后才让行，`:278–295` 以 3 秒冷却、preserveAttempt/schedulingYield 释放 writer。reader 回调和任务快照使用聚合进度，没有新增逐文件事件。
- **控制和完成事务**：`:219–275` 的 finalizer 先取得 runtime lease/job 围栏，允许读取 PAUSING/CANCELLING 控制状态；关闭失败、取消、暂停和 shutdown 先于正常完成。页事务只接受 RUNNING，失租约或控制请求不能提交当前结果。完成 helper 与 `scope.complete` 使用同一事务；最终快照变化只按 helper 的 STALE 结果完成，不用一次 checkpoint 冒充 READY。runtime 在实际提交边界再次检查 fence，并在 callback 后才转任务终态。
- **根映射和 SCAN 提取**：`root-bindings.ts:4–22` 保留原函数的 version、source/archive logicalRoot/rootIdentity、archiveRelativePrefix 比较。SCAN diff 只将该原函数移出，并把原仅搜索 Run 的退出探针改为共享搜索；其 stat/hash、预算、关闭、分组和完成代码未在本批改写。维护每 slice 开始和结束均调用同一完整映射比较。
- **Worker 和恢复入口**：registry `:64–81` 向 SCAN/维护传入同一个 supervisor 和固定 entrypoint；新 type/version 及 production inventory / audit / tests 一致为 39/47，仍为三 lane。CLI 严格互斥 `--run` 与 `--operation`，recover 仍要求 digest、原 token、operator、stopped-writers 确认；dispatcher 直接调用对应共享 DB inspect/recover，没有新增绕过停止核验或 token CAS 的分支。

上述为静态调用链结论，不能表述成本次独立执行了全部控制、故障和恢复组合。

## 独立最小验证

临时材料保留于 `/private/tmp/pixishelf-orchestration-review-sol/`，使用实际导出的共享 latch 与 root-bindings 函数，DB、进程证明和错误类为测试 doubles。没有连接数据库、启动 reader、访问媒体或执行文件操作。

```bash
pnpm --filter @pixishelf/job-executors exec vitest run --config /private/tmp/pixishelf-orchestration-review-sol/vitest.config.mts --root /private/tmp/pixishelf-orchestration-review-sol shared-boundaries.test.ts
```

结果 **7/7 通过**，实际用例约 5 ms，Vitest 总耗时约 0.17 秒：

- 无持久 latch 时不 probe、不 release。
- SCAN 与 MAINTENANCE 两类都在退出证明后，将原 job/id/executionVersion/token 交给准确的 release helper。
- 无有效 owner、无退出证明两种情况均保留占用并返回 READER_CLOSE_FAILED。
- 原 token CAS 失败直接传播，不改用另一类目标或重试替代身份。
- 完整根映射可等值续跑；version、两根 logicalRoot/rootIdentity 或 prefix 改变，以及 prefix 缺失均拒绝。

实现者已通过的归档 2 项、编排 10 项与真实 SIGKILL 1 项、SCAN 提取相关 3 项、Worker registry 8 项、audit 7 项、CLI 2 项及两包 typecheck，均仅作为[原批交接证据](./artwork-deduplication-prepare-orchestration-2026-10-24.md)引用，没有计为本次独立重跑。新增测试静态确认覆盖 gate 拒绝零 spawn、只读 READY 原子完成、预算续跑、PAUSING/CANCELLING、snapshot/root 变化、旧 lease 拒绝和 close 确认丢失后的原 token 退出证明。

## 限制与交付

没有使用 `dedup_executor_next`、真实业务数据库、`dedup_scale`、真实媒体或规模夹具；没有运行全量 App/Worker build/test、浏览器或原生写基础复审。真实 SIGKILL 证据仍是独立 Worker 夹具与固定 child，不等于完整部署 Worker、NAS 或断电演练。共享 DB 离线恢复和 App PAUSED/BUILDING 继续的独立审查由数据线负责，本报告只核对 CLI 的解析/分发和执行器调用边界。

文件写基础复审仍有平台阻断，不能据本报告开放文件动作。后续是否提升第三阶段门禁，仍须统筹结合数据恢复链独立审查、其余未审依赖和最终集成验收决定。

交付检查：`pnpm docs:check` 通过，检查 223 份 Markdown；`rg --files packages/pixishelf | rg '[A-Z]'` 无输出；本记录的 `git diff --no-index --check /dev/null <record>` 无空白错误（有新增内容故返回 1）。只格式化本记录。未修改 Mermaid/SVG，按本批审查限制没有重复图表渲染、图示检查或安装浏览器。
