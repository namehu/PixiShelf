---
status: historical
scope: F03 第二批 QUERY 往返优化的独立差异审查及 10,001 条同样本证据核对
last-verified: 2026-10-27
sources:
  - packages/pixishelf-job-executors/src/artwork-dedup/visual-batches.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/visual-batches.postgres.test.ts
  - docs/design/artwork-deduplication/visual-batches-f03-contract.md
  - docs/records/artwork-deduplication-roundtrips-f03-2026-10-27.md
---

# F03 第二批独立审查

2026-10-27，Sol 6.1 / xhigh，审查者未参与实现。范围为分支 `codex/dedup-visual-batches-f03` 相对 `ea0a140b` 的 QUERY 事务合并、相邻测试及必要执行围栏调用链；不重新审查整个去重系统。审查没有运行测试、构建、数据库负载或浏览器，运行证据来自下列已读取的实施日志。

## 冻结版本与结论

生产文件 SHA-256 为 `d422096c91ad292fd4ad96b2fd7516b603efdaf2f42dbf94212243b768567a06`，测试文件为 `41e4086fb3de6f76cbd05786aa4970d934ab736885b5704001119bea5dd5f18b`。

静态差异、必要调用链及最终 10,001 条同 fixture A/B 证据核对完成，未发现本批引入的 P1/P2 问题，无独立审查阻断项。完成后再次核对生产／测试文件 SHA-256，均与冻结版本一致。本结论仅覆盖本批代码和所列相关验证证据；桌面验收及交付检查由主 agent 另行收口。

## 事务和恢复边界

- `assertArtworkDedupExecution` 在 dispatch 读取事务内持有 run 的 `FOR UPDATE` 锁；同一事务内解析检查点，读取查询媒体、posting 和最多 50 个候选。新 helper 没有把读出的 run 作为下一事务的授权。
- `compareProductionVisual`、候选比较循环及 `setImmediate` 均在事务外。让出前后分别检查取消；提交事务重新执行 run 围栏。实际执行器仍将每笔事务交给 `withFencedMutationTransaction`，该方法在事务开始和实际提交边界校验运行状态及租约。
- 提交继续调用原 `guardArtworks`，保持 catalog → roots → directories → Artwork 锁序和当前源、目录、写入声明检查。边、比较计数和候选／查询游标仍在同一事务提交；写入计数使用提交事务内的最新 run。
- 读出的检查点和计数只用于当前有界比较，提交前继续验证执行版本；重领、取消及控制状态不能通过旧 dispatch 读数获得写入权限。事务回滚后下一次调用从数据库重新解析检查点。
- posting 查询保留 `queryPostings + 1` 的有界读取和 multiplicity 核算，候选列表保留既有上限；每块只加载 50 条候选。预算错误仍走原 `INCOMPLETE` 路径，没有提高预算、截断后完成或扩大持锁视觉计算。
- checkpoint schema、version 1、任务 v5、数据库／通用 guard helper 均未改变。原候选后缀筛选、尾块推进和分块恢复方式保持；INDEX、REUSE、PAIR、PUBLISH 沿用原路径。

## A/B harness 核对

临时脚本 `/private/tmp/f03-roundtrips/run-ab.mjs` 通过 `git show ea0a140b:packages/pixishelf-job-executors/src/artwork-dedup/visual-batches.ts` 保存基线。审查独立核对原文件 SHA-256 为 `b96bf6aa14d41c4f18109a5229205968e87777425bed4761d18754b1d5cb7510`；临时可加载模块 `745e52c746fdbcafe6420b153ea8c4c6996ebd572849ff84502c43c4c5a192cb` 与原文件差异仅为 import 路径。相关被引用生产模块没有本批改动。

两轮使用同一个 prepared READY fixture 和 run，保留媒体 ID、SHA、特征及源／目录快照。输入 digest 包含完整 run 媒体、item 的冻结修订和快照字段，以及根／目录状态；每轮扫描前后均断言 digest 不变。fixture 为 FULL 且 `forceRead`，无历史关系复用，Reader 在调用时直接报错。

基线结束后，reset 清除 posting、候选、复用签名和检查点，再清除已发布 pair、清空视觉签名并还原阶段、视觉状态、原因、候选 key 和比较计数。媒体特征及原输入保留；优化版不能借用前轮候选、证据或完成状态。

结果以 `toEqual` 比较状态、原因、比较／复用计数、完整候选 key 数组、按作品和 ordinal 排序的每个 pair／页面 kind 及左右 imageId，以及 posting 数；不只是比较结果数量。

120 条 smoke 的 SQL `6,142 → 4,698`、事务 `617 → 256`，写语句均为 867，输入及结果 digest 一致。但该 fixture 只有一个作品，比较数为 0；它只支持计量路径和 reset 检查，不能证明跨作品匹配等价。

10,001 条 A/B 完整日志为 `/private/tmp/f03-roundtrips/ab-10001.log`，1 项通过、11 项未选择／opt-in 测试跳过，含清理总耗时 939.03 秒。只执行一次基线及一次优化版扫描，没有拿上一批不同样本或 20 块 profile 充当对照。已核对该日志、由其生成的 `metrics.json` 和 `verification.md`，数值一致。

| 指标                         |       基线 |     优化版 |
| ---------------------------- | ---------: | ---------: |
| SQL 事件（含 BEGIN／COMMIT） |    501,125 |    381,106 |
| BEGIN 事务                   |     50,046 |     20,042 |
| 写语句                       |     70,530 |     70,530 |
| 实际比较／复用比较           | 27,536 / 0 | 27,536 / 0 |
| posting                      |    400,040 |    400,040 |
| 候选／发布作品对             |      1 / 1 |      1 / 1 |
| 最大媒体 findMany 结果       |      1,000 |      1,000 |
| 原媒体读取字节／视觉解码调用 |      0 / 0 |      0 / 0 |
| 单次内核耗时                 | 492,382 ms | 440,191 ms |

两轮输入 SHA-256 均为 `e2277cfd8452d73c96a6265c4fa00295ee3ceaa14e53bfc6a3b0f48e0e23fd13`，完整结果 SHA-256 均为 `4262425b15acf9150d0506fdf512e1d1dca99b784faaac5a4672657899ba7503`。事务减少 30,004（59.95%），SQL 事件减少 120,019（23.95%），写入及逐页证据保持一致；单次耗时减少 10.60%，受下文计量边界限制。

## 已读取的验证证据及限制

| 日志（均在 `/private/tmp/f03-roundtrips/`） | 实际证据                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck.log`                             | executor 类型检查完成，无错误                                                                                                                                                     |
| `checkpoints.log`                           | 8 项通过：密集 120 条的阶段重建、候选前缀回滚／恢复和旧算法逐页等价；两项历史清理；原取消／执行／源检查；新读取后与提交前各循环取消、执行版本、源、目录、根、write token 六种故障 |
| `real-v5.log`                               | 3 项通过：真实 Reader 的冷／热／改单图／FULL；PUBLISH 的租约过期和目录变化拒绝                                                                                                    |
| `ab-smoke-escalated.log`                    | 上述 120 条同 fixture smoke，1 项通过                                                                                                                                             |
| `ab-10001.log`                              | 上述 10,001 条同 fixture A/B，1 项通过，完成清理；结果逐页相等                                                                                                                    |

新增 QUERY 故障中的执行围栏注入改变的是 run 的 `executionVersion`；实际租约过期注入来自 PUBLISH 用例。本记录将调用链核对与运行注入证据分开，不将后者称为 QUERY 租约专项实测。

同 fixture A/B 在同进程依次执行基线和优化版，未清空 PostgreSQL／操作系统缓存，也未强制 GC。`maxRSS` 是进程累计高水位；采样 heap 受 GC 和前轮保留对象影响。单次耗时和内存只作该次观察，确定性收益以 SQL／事务减少及结果等价为依据。

本次审查没有桌面验收证据，也没有 100,000／500,000 或真实图库实验。上述范围不得登记为通过。文档汇总检查由主 agent 在收口时统一执行。
