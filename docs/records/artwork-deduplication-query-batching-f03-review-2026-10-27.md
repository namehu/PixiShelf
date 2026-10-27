---
status: historical
scope: F03 第三批 SQL 归因与 QUERY 有界批处理的独立差异审查及证据核对
last-verified: 2026-10-27
sources:
  - ../../packages/pixishelf-job-executors/src/artwork-dedup/visual-batches.ts
  - ../../packages/pixishelf-job-executors/src/artwork-dedup/__tests__/visual-batches.postgres.test.ts
  - ../../packages/pixishelf-job-executors/src/artwork-dedup/__tests__/visual-sql-profile.ts
  - ../../packages/pixishelf-job-executors/src/artwork-dedup/__tests__/executor.postgres.test.ts
  - ../design/artwork-deduplication/visual-batches-f03-contract.md
  - ./artwork-deduplication-query-batching-f03-2026-10-27.md
---

# F03 第三批独立审查

2026-10-27，Sol 6.1 / xhigh。审查者没有参与实现，仅写本记录；对比分支 `codex/dedup-visual-batches-f03` 与基线 `b4943c80` 的生产差异、相邻测试与必要围栏调用链，不重新审查整个去重系统。没有运行测试、数据库负载、构建或浏览器操作，也没有修改保留的 A/B fixture。

## 冻结版本与结论

已核对的生产文件 SHA-256 为 `779d1f831509f96b50e482931eaa5bfe132d4f0711f0349ec4f460e0660edcbf`。生产差异仅在 `visual-batches.ts` 的 QUERY 组装、比较与提交路径及其 dispatch 调用；数据库 helper、其他视觉阶段、schema、任务 v5 与 checkpoint version 1 保持原有实现。

静态差异、必要调用链、定向测试的最终通过证据、执行器类型检查及 10,001 条同 fixture A/B 均已核对，未发现本批引入的确证 P1/P2，无独立代码／测量审查阻断项。核对结束时生产及以下测试指纹均与冻结版本相同。最终构建、桌面运行验收与交付检查由主 agent 另行收口，本结论不表示这些项目已经通过。

相关测试指纹：`visual-batches.postgres.test.ts` 为 `c04f79bc729d06e06606f0fc885e4246e012f58fcb088473ccd0ef6672baa8ca`，`visual-sql-profile.ts` 为 `bc71b911b49aefec4a4a7046ab489af319aabac435a7defa490c37f2bb7e2ebf`，`executor.postgres.test.ts` 为 `0097a7399f5c75eb24a0a290bf5ab6b7b37e09c7f6826f98bd5fcd752743370c`。

## 批次、游标与预算

- 读取最多 8 个查询媒体。候选槽按每个查询分别消耗，累计最多 50；按唯一 ID 一次加载最多 50 条候选特征。即使因作品上限或后续预算舍弃后缀，已读取的查询／候选特征仍不超过 58 条。各查询的 posting 分别受原 20,000 预算约束，不把全部 posting 保存到批次计划中。
- posting multiplicity 与完整候选去重数先按原预算核算，再截取本批候选槽；不能通过分批绕开原查询预算。组装在查询之间检查 100 ms 软预算及让行信号，不承诺中断单次 SQL；至少接纳第一块，避免即时让行导致永久不推进。
- 作品上限在按查询、候选 ID 顺序形成最终块时执行，最多 51 部。无法接纳的查询不进入块；查询内只接纳连续候选前缀。只有实际接纳候选数等于该查询剩余候选数时才推进 `queryAfter`，否则保存该查询的完整候选列表及最后实际接纳 ID，并停止批次。
- 旧版部分查询从 `queryImageId` 读取，并仅处理 `candidateAfter` 之后的候选；缺失目标查询会报输入变化。新实现继续写原 version 1 字段，不把预读但未处理的页面视为完成。
- 比较在读取事务外进行，每块先收集局部边及计数。后续块触及运行比较预算时，丢弃该块局部计算，仅提交此前合法块；第一块即超限仍走原 `INCOMPLETE` 路径。让行也仅提交已比较前缀。
- 提交时在 run 锁内一次读取所需作品对；只在存在新对时统计全 run 对数，再按块顺序选择作品对预算内的前缀。截断后重新汇总前缀的边、计数、游标和作品集，未提交计算不会进入持久计数。新增对批量插入，同一已有对每批至多更新一次；没有边时不查询或统计候选对。

## 提交围栏与锁序

读取事务中的 run 检查不替代提交授权。比较循环保留取消检查，事件循环让出前后再次检查取消；提交事务重新执行 `assertArtworkDedupExecution`。

提交选定的前缀包含每个实际处理的查询及其全部候选作品，包括未形成匹配边、因作品顺序跳过或命中复用负证据的候选。作品集去重后交给原 `guardArtworks`，继续使用 catalog → 全部 roots → directories → Artwork 的原锁序，保留目录身份／代次、来源修订／epoch、冻结媒体修订、可见作者成员及写入声明核验。候选对预读没有取得新的逆序行锁，结果写入在完整 guard 之后。

边、比较／复用计数与最终前缀游标在同一事务保存；计数以提交事务内的最新 run 为起点。执行器仍通过 `mutateInTransaction` 调用队列的 `withFencedMutationTransaction`，该方法在事务开始和提交边界校验真实租约，因此长于租约的提交也不能发布过时检查点。

## SQL 测量与同 fixture 方法

已核对测试 instrumentation 和 `/private/tmp/f03-query-groups/probe.json`、`baseline.json`、`optimized.json` 及对应日志。归一化只处理参数占位符及空白，不保存绑定值、连接信息或私人路径。profile 的各语句计数之和与内核 SQL 事件总数一致，事务 BEGIN／COMMIT 也计入 SQL。

阶段取同事务首个 run 读取的 checkpoint；没有 run 读取时沿用上一阶段，准备及首次 INDEX 合并标为 `PREPARE/INDEX`。这是一种应用侧事务归因，不是 PostgreSQL 服务端阶段标记。事件在阶段切换时可能晚到：优化版 `PREPARE/INDEX` 为 5 BEGIN／4 COMMIT，INDEX 为 22 BEGIN／23 COMMIT，全局 BEGIN 与 COMMIT 均为 2,942；因此单条事务控制事件的阶段归属有这一限制。Prisma query event 的整数毫秒值与事务 wall、内核总 wall 分开，不能把大量零值解释为没有成本，也不能把语句耗时之和视为端到端耗时。

120 条、两个作品的探针为 4,792 条 SQL，其中 QUERY 4,572 条；目录状态读／写 1,440 条、run 锁／读取 724 条、事务控制 484 条，支持先共享重复 guard 的实施选择。完整 10,001 条基线为 381,105 条 SQL、20,042 笔事务，内核 419,456 ms；QUERY 为 380,076 条 SQL、20,004 笔事务，事务 wall 合计约 403.1 秒。基线生产源码 SHA-256 为 `d422096c91ad292fd4ad96b2fd7516b603efdaf2f42dbf94212243b768567a06`，在扫描前固定，与 `b4943c80` 对应。

两轮使用同一个 FULL、`forceRead`、已准备 READY 特征的 run。已逐项确认两个 manifest 的 run、job、artist、prefix、count 和初始状态相同。输入 digest 包含完整去重媒体、冻结 item 字段、Image／Artwork 及其 source、根／目录状态，重置前后及每轮扫描后核对不变。reset 清除 run 工作 posting、候选、复用签名和检查点，并清除已发布 pair、视觉签名、还原初始阶段与计数；不会借用基线完成结果。Reader 如被调用即报错。

结果 digest 包含状态、原因、比较／复用计数、完整候选 key 数组、按作品及 ordinal 排序的每个 pair／页面 kind 和左右 image ID，以及 posting 数。仅结果数量相同不足以通过对照。

两轮输入 SHA-256 均为 `1002f25e673cefffbc1456b104b3c5705ebf15ef42eeb92ae0f2b39dca24f083`，结果 SHA-256 均为 `68d295a3e7117e80d83327170db2ff977ff76325fdbd7d4b1b58ccda55d6a189`。审查直接比较完整 `outcome` 对象并独立重算结果 digest，均相等。基线日志为 1 项通过、12 项未选择；优化版日志为 1 项通过、19 项未选择，数量差异来自此后新增专项测试，不是另跑了其他规模档。

| 指标                             |             基线 |         优化版 |
| -------------------------------- | ---------------: | -------------: |
| 全部 SQL 事件（含事务控制）      |          381,105 |         63,285 |
| BEGIN 事务                       |           20,042 |          2,942 |
| 写语句                           |           70,530 |         10,680 |
| QUERY SQL／事务                  | 380,076 / 20,004 | 62,257 / 2,904 |
| QUERY 事务 wall 合计             |       403,101 ms |      98,000 ms |
| QUERY 最大单事务 wall            |         229.5 ms |       233.8 ms |
| QUERY Prisma event duration 合计 |        80,395 ms |      39,921 ms |
| 内核 wall                        |       419,456 ms |     111,205 ms |
| 比较／复用比较                   |       27,536 / 0 |     27,536 / 0 |
| posting                          |          400,040 |        400,040 |
| 候选／发布作品对                 |            1 / 1 |          1 / 1 |
| 最大媒体 findMany 结果           |            1,000 |          1,000 |

SQL 事件减少 83.39%，事务减少 85.32%，写语句减少 84.86%。写语句包含目录 helper 的 `INSERT … ON CONFLICT DO NOTHING`，不等同实际新增数据库行数；匹配结果及比较计数保持不变。内核单次 wall 观察减少 73.49%，测量区间不含 fixture 准备、重置、输入／输出摘要核验或清理；这些额外步骤没有独立性能指标，不把整个测试总耗时当作内核耗时。

优化版累计边界为单事务最多 8 查询、50 候选、58 查询加候选特征；本 fixture 共 11 部作品，guard 最大为 11，51 部边界由下面专项单独验证。最大媒体 findMany 的 1,000 来自按作品 INDEX／PAIR 读取，不能作为 QUERY 批次总驻留上限的证据。100 ms 仅限制查询间组装，最大事务 wall 没有下降，也没有形成严格的事务耗时上限。

基线 profile 生成后才加入每事务查询／候选总行数及 guard 作品数的计量，基线没有该 `bounds` 字段；优化版多这些轻量应用侧计量。两轮使用不同进程，顺序执行；没有清空 PostgreSQL／操作系统缓存，也没有强制 GC。此差异不改变 SQL 或 fixture，但 wall／heap 不是严格相同 instrumentation 下的重复实验。采样 peak heap 为 117,130,080 → 113,754,136 字节，进程累计 maxRSS 为 312,344,576 → 325,959,680 字节；它们不能支持内存改善的结论。单次 wall 和这些内存值仅为本轮观察，不能推出原图解码、NAS 或 10 万／50 万能力。

## 定向验证证据及早期失败

以下日志均位于 `/private/tmp/f03-query-groups/`。审查读取了每项结果与最终测试差异，没有为获得单一全绿日志重复执行这些用例。

| 日志                         | 已核对的实际结果                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `group-boundaries.log`       | 2 项通过：8 查询前缀／组回滚／即时让行，以及新旧作品对合并写入／部分查询续跑／旧匹配器等价。该次另外 5 项失败，不记作通过。                                     |
| `group-boundaries-fixed.log` | 4 项通过：51 部作品截尾及候选、比较、作品对三种后续预算失败保留首查询。posting 用例仍失败，不记作通过。                                                         |
| `recovery-guards.log`        | 9 项通过：各阶段重建／候选前缀回滚／旧匹配器逐页等价，两种历史清理，取消／执行版本／来源拒绝，读取后及提交前的六种故障矩阵，以及修复后的 posting 后续预算失败。 |
| `real-v5.log`                | 4 项通过：真实 Reader 冷／热／改单图／FULL；真实 QUERY 租约失效；PUBLISH 租约过期和目录变化拒绝。其余 60 项未选择。                                             |
| `typecheck-final.log`        | 执行器包 `tsc -p tsconfig.json --noEmit` 完成，无错误。                                                                                                         |

最初的 5 项失败都发生在新测试构造数据时：媒体更新使用了不存在的 `runId_imageId`，后改为 schema 的 `runId_artworkId_imageId`。修复后 posting 测试又因写入 multiplicity 20,001 违反已有最大 4 的约束而失败；最终使用 5,001 条 multiplicity 4 的合法 posting 触发总 posting 预算。后续日志按具体用例覆盖了这些失败，修复仅涉及测试，没有解冻生产实现。旧类型检查失败同样由媒体复合键修正，最终日志通过。

由此共有 15 个不同的 core 专项用例通过，不将同一次带失败的日志整体称为通过。六种故障矩阵分别注入取消、执行版本、来源路径、目录代次、根身份和写入 token；断言 checkpoint、比较／复用计数、候选和发布 pair 保持未提交状态。真实 QUERY 测试使用实际执行器和队列围栏，在读取批次后更换 `system_jobs.leaseToken`，下一次提交被真实 lease fence 拒绝；该项不是租约时长到期专项，时长到期证据来自原 PUBLISH 用例。

## 验收边界

本审查没有执行浏览器、Worker 构建、生产部署或真实图库实验。桌面运行中暂停／继续、Worker 重启恢复、唯一最终构建及文档交付检查由主 agent 与独立浏览器 agent 另行收口；本记录不替代这些验收，也不调整公开 10,000 原件上限。
