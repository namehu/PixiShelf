---
status: historical
scope: 视觉检索 v2 未提交差异的独立代码审查、定向复现与修复复核
last-verified: 2026-10-29
sources:
  - docs/design/artwork-deduplication/visual-search-v2.md
  - docs/records/artwork-deduplication-visual-search-v2-2026-10-29.md
  - packages/pixishelf-job-executors/src/artwork-dedup/executor.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/visual-search.ts
  - packages/pixishelf-job-runtime/src/queue-repository.ts
  - packages/pixishelf-worker/src/dispatcher.ts
---

# 视觉检索 v2 独立审查

## 结论与范围

2026-10-29 最终差异复审：**没有未修复的 P0/P1/P2 finding**。审查过程发现 1 项 P1、6 项 P2，均已修复并完成代码复核。此结论只针对本次审查的代码快照，不代表生产部署、独立重跑全部专项或最终代码已重测全部性能目标。

在 `codex/dedup-visual-search-v2`、基线 `3a5b5ee26eec303378ed8b852379b033ef625420` 上审查当前未提交差异。范围包括两通道索引、计算线程、持久游标/计数、关系缓存、提交围栏、v8 迁移、executor 生命周期、进度与性能日志契约，以及最后增加的 immediate schedulingYield 队列修复。审查者只写本记录与 `/private/tmp` 独立复现 bundle；未修改实现、主目录、生产数据库或媒体。

最终复核的关键源文件 SHA-256：

| 文件                                                                                          | SHA-256                                                            |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [executor.ts](../../packages/pixishelf-job-executors/src/artwork-dedup/executor.ts)           | `e429cda09f752500cca14507be863acf2c78e896036b4f1249302b3a4eed6fa6` |
| [visual-search.ts](../../packages/pixishelf-job-executors/src/artwork-dedup/visual-search.ts) | `8358c309aab1fa77f01891813ef6eb55e5824bd3427de84ddf490bbddf5d6c4b` |
| [queue-repository.ts](../../packages/pixishelf-job-runtime/src/queue-repository.ts)           | `7811f9e3025252a15933fbe116bcfcbd277b1571c44ca57f447a20b504eb0fac` |
| [job-progress.ts](../../packages/pixishelf/lib/job-progress.ts)                               | `09bb1af3819d29304372aa6f83d628a3453a62993e5038dbc0f4a597cf2ff4c6` |

## 已修复的 P1

### 零冷却自动让行与队列最终时间校验冲突

位置：[executor.ts](../../packages/pixishelf-job-executors/src/artwork-dedup/executor.ts) 的 `scope.retry` 立即重排；关联 [queue-repository.ts](../../packages/pixishelf-job-runtime/src/queue-repository.ts) 的 `withFencedExecutionTransaction`。

v8 纯计算把 availableAt 设为当前时间，但队列的 scope.retry 和 callback 结束后的最终校验均拒绝过去时间。构造 availableAt 到调用/最终校验之间只需跨 1 毫秒，自动让行的最终事务就失败。

独立确定复现：把实际 queue-repository.ts 用 worker 包已有 esbuild 打包到 `/private/tmp/pixishelf-visual-search-v2-20261029/review-queue.cjs`。使用实际 PostgresQueueRepository，仅替换数据库事务、执行权锁及真正提交；callback 调用 schedulingYield/preserveAttempt=true 的 scope.retry 后将 fake clock 从 0 推进至 1 毫秒，实际 finalizer 抛出 `Retry availableAt cannot be earlier than the current queue clock`。

修复只对显式 schedulingYield 将 availableAt 解释为最早可调度时间，在最终提交时取 requested 与 finalizedAt 的较大值，并同步事件时间；preserveAttempt 约束、普通 retry 两处过去时间拒绝、租约/任务围栏、attempt 与资源释放路径保留。没有增加固定计算冷却。

独立用修复后实际源码重新打包反测 **3/3 通过**：立即 yield 跨 1 毫秒成功且事件时间同步；未来 yield 时间保持未来值；普通 retry 仍拒绝过期且不执行 transition。实现者另报告真实 PostgreSQL 7 项定向用例与 runtime 类型检查通过；测试代码已审阅，本审查未重复运行该 PostgreSQL 套件。

## 已修复的 P2

### 读取心跳重放旧结构化进度

位置：[executor.ts](../../packages/pixishelf-job-executors/src/artwork-dedup/executor.ts) 的 reader.onProgress；关联 [dispatcher.ts](../../packages/pixishelf-worker/src/dispatcher.ts) 的 createProgressReporter。

原 v8 心跳向 context.progress 传入捕获的 latestProgress。STANDARD 策略可以把 FEATURES 10/100 留在 pending；领域提交较新 20/100 后，flush 又覆盖回旧快照。当前读取心跳已省略 progressData，repository 对 undefined 保留现有结构化快照，权威进度仅随领域检查点写入。修复已复核。

### 同一执行片内活跃时长重复累计

位置：[executor.ts](../../packages/pixishelf-job-executors/src/artwork-dedup/executor.ts) 的 saveTelemetry。

原公式正常情况下每次累加本片整个已逝时间，同片第 1、2、3 秒保存得到累计 1、3、6 秒。当前改为 activeMs - savedActiveMs，并只在事务成功后推进水位；回滚不会提前推进水位。最终代码和覆盖多次检查点/回滚的专项测试代码已复核。

### 前置特征阶段汇总缺少检索版本

位置：[visual-search.ts](../../packages/pixishelf-job-executors/src/artwork-dedup/visual-search.ts) 的 initialize 与续跑解析。

原 executor 特征阶段建立 searchVersion=null 的汇总，检索初始化复用该汇总却未补版本。当前 initialize 显式设置 VISUAL_SEARCH_VERSION 与 INDEX 阶段，续跑解析也补正确检索版本。修复及从已有 FEATURES/null-version 快照启动的 PostgreSQL 回归代码已复核。

### 旧记录把未知未核对数量显示为零

位置：[artwork-dedup-service.ts](../../packages/pixishelf/services/artwork-dedup-service.ts) 的 DTO；关联 [duplicate-run-status.tsx](../../packages/pixishelf/app/admin/duplicates/_components/duplicate-run-status.tsx)。

旧 v7 记录没有新增进度/性能快照，原回退值 0 会掩盖 UNCHECKED 媒体。当前 DTO 返回 nullable 未知值，检查页明确显示“未核对媒体数量未知”；没有为轮询新增媒体 COUNT。修复及 DTO/UI 契约已复核。

### 最终事务的 DB 调用与事务数量漏计

位置：[executor.ts](../../packages/pixishelf-job-executors/src/artwork-dedup/executor.ts) 的 finalizeInTransaction。

原最终 scope.transaction 未代理且未计事务数，每个自动让行片少计一个最终事务，完成片还漏目录复核、buildArtworkDedupGroups 等业务调用。当前 v8 finalizer 将已知事务数计入，并通过 measureDedupDatabase 统计业务 API 到快照构造点的调用，合并待归集读取；旧协议保留原路径。精确计数的专项代码已复核。

采集边界明确为：complete 表示生命周期成功发布；updatedAt 是该快照构造点，之后的快照自身写、事件写、queue settle 与 commit 不在该次采样中。最终事务数计已知 1，transactionWall 只含此前已完成的 mutation/cleanup，当前 finalizer 的完整 wall 尚未知，没有伪造或为测量新增回写事务。运行时 API 调用计数不能当作 SQL 条数。当前功能规格、runbook 与两份只读 SQL 的说明已同步该边界，SQL 将完成标记命名为 lifecycle_complete。

### 后置清理失败把已建立的索引带入同 run 重试

位置：[executor.ts](../../packages/pixishelf-job-executors/src/artwork-dedup/executor.ts) 的 finally 与终态失败分支；关联 [artwork-dedup-service.ts](../../packages/pixishelf/services/artwork-dedup-service.ts) 的原范围 retry。

原 finally 在等待 progressPending、关闭 reader、释放声明之前决定保留缓存；之后失败可以终结为 FAILED，却不清除 built 索引。retry 保留 runId，新特征可能继续使用仅以 runId 标识的旧索引。当前 closeSearch 先清 worker/built，再等待终止；finally 的后置清理失败和最终 guard 新发现的失败都会再次关闭缓存。人工暂停、取消、预算等待亦释放缓存。专项代码明确注入后置 reader release 失败，断言旧 worker 关闭，再由新 executor 在同 run 重试创建新 worker；修复已复核。

## 其他最终差异复核

- 两通道阈值、同一视图对局部投票、裁剪/信息/比例条件、SHA 一对一配对、混合媒体未核对状态保持既定语义；10,000 登记原件上限不变，128 MiB 是特征与索引估计预算。
- v8 关系复用需要同检索版本与完整静图覆盖；旧负结果不继承，变化作品仍与未变作品比较。热复用跳过索引和候选遍历；安全判断在提交时重新校验。
- 结果、查询游标、比较计数与性能/进度快照同事务。PAIR→PUBLISH 与 REUSE→QUERY 的内部回调没有新增事务，SystemJobEvent 亦在原事务写入；outer finalize 是 COMPLETED 唯一 owner。
- 复用计数只在持久 REUSE→QUERY 转换提交一次；重放查询仅在持久 mid-query 游标且线程候选缓存缺失时记录，未知未提交比较的重放量保持 null。精比时长按实际 matched 调用测量，没有把索引访问当精比或把 API 调用当 SQL。
- scheduler UI 在 RUNNING 业务状态下尊重持久 SCHEDULER 等待原因，保留阶段与数量；明确暂停、取消、失败和完成状态优先。检查页没有把自动等待当作手动暂停，未改变服务端状态/授权映射。

## 验证与性能证据边界

本审查独立执行了上述 runtime 确定复现/3 项反测、git diff --check 与主应用大写路径检查，后两者无错误或匹配。`pnpm docs:check` 检查 328 份 Markdown 通过；`WEBP_BROWSER_CHANNEL=chrome pnpm docs:diagrams:check` 检查 34 份图源与 23 处内嵌 Mermaid 通过，使用本机 Chrome 并因沙箱启动 SIGABRT 提升权限执行。未独立运行产品浏览器流程、全量 lint/test/build、完整 PostgreSQL 套件或性能基准。

实现者报告的核心 17 项 PG/index 与 2 项 oracle、UI scheduler 84 项、lifecycle/database 9 项、真实 PG 新 executor 实例续跑 1 项、runtime 7 项与类型检查，分别以其实际执行证据为准；本记录不把作者报告改称审查者独立重跑。

[本轮实施记录](./artwork-deduplication-visual-search-v2-2026-10-29.md) 的正式 5,000 原件 A/B 使用其证据所记录的 source hashes，早于后续 metadata/计时、executor finalizer 统计和 immediate-yield 修复。专用 SQL/事务 collector 不受 executor 原漏计影响；这些后续修改有定向专项，不代表对最终代码重新执行整个 5k 基准。本审查不据此宣称最终 revision 重新测得相同降幅。

oracle 证据边界保留：两处既有模板误配、黑遮挡样本 8/9、5k 差异造成四个未配对页，均不能用检索完整性通过替代语义识别率结论。密集查询两次 20.63/306.36ms 均登记，不择优。性能与浏览器验收结论仍由实施记录说明，不由“无未修复代码 finding”推断。
