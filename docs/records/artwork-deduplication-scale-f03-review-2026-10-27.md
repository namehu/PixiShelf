---
status: historical
scope: F03 第四批新增测试、预制特征冷热与密集续跑证据独立审查；不代表生产规模能力
last-verified: 2026-10-28
sources:
  - docs/design/artwork-deduplication/visual-batches-f03-contract.md
  - docs/records/artwork-deduplication-scale-f03-2026-10-27.md
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/visual-scale-fixture.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/visual-scale.postgres.test.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/visual-dense-resume.postgres.test.ts
---

# F03 第四批独立审查

审查日期：2026-10-27 至 2026-10-28。审查者为未参与测试实施的 Sol 6.1 / xhigh，工作区为 `codex/dedup-scale-validation-f03`，基线 `912f7e7311209464c551a25281c5af3099af95a7`。本次只审新增测试、直接计量调用及保存的执行证据；没有修改生产代码、运行数据库重测或全量验证。审查者唯一新增文件为本记录。

本批限定审查范围通过，无未解决 P1/P2。密集候选、5,000 条探针、100,000 条完整冷热轮及桌面预算反馈证据均已核对；保留一条热轮 COMMIT 事件未归因的计量缺口及本批桌面暂停未成功的限制。该结论不表示生产规模能力或吞吐达标，公开 10,000 上限保持不变。交付事实由[第四批执行记录](./artwork-deduplication-scale-f03-2026-10-27.md)集中登记。

## 审查范围与冻结输入

按[F03 第四批契约](../design/artwork-deduplication/visual-batches-f03-contract.md#第四批验证范围)，本批验证有界检索、持久前缀、跨进程接续和关系复用，不调整生产公开上限、删除行为或迁移。生产 `VISUAL_LIMITS` 的 10,000 文件、1,600,000 posting 和 200,000 比较保持不变；扩大额度仅存在于显式启用的规模测试模块。单作品、单查询及作品对等其他保护沿用原值。

持久证据根为 `/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-f03-scale-20261027`。下文路径均相对此根。

- `harness/source-hashes-replay.json` 的七个 SHA 与当前源码及 `harness/sources-replay/` 副本逐项一致。四个生产文件没有变化；`visual-batches.ts` 为 `779d1f831509f96b50e482931eaa5bfe132d4f0711f0349ec4f460e0660edcbf`。最终 replay 测试 SHA 为 `a0091fce41fbc77d8729052f1c111c09908d1741b9fb737b8612ec8d552d5b5c`，fixture SHA 为 `bbb8abdf835c2a141840821c8738d1ac0bbb7874be6007790b1e3e3c508ec734`。
- 100,000 条输入为 100 部作品各 1,000 条 READY 预制特征，100,000 个不同媒体 ID。独立 oracle 逆推此 fixture 的候选桶，以数值 popcount 核对全部候选边，再按唯一边及阈值生成配对；不调用生产索引、比较器或 assignment，也不做全量两两比较。
- `harness/scale/manifest.json` 与两段冷轮均记录输入 SHA `b19735b712c996b45339eb90a85e4ba3c07395fbe1368d314052b31074cea60a`。测试在扫描前后检查输入摘要，摘要覆盖作品、媒体、内容身份及根／目录状态。replay 没有重造输入或更换媒体 ID。
- 规模入口严格限定 `127.0.0.1:55432/dedup_f03_scale_kernel_20261027`；密集套件仅由专用变量启用并限制 `f03_dense_resume_*`。两者均使用专属正式迁移库，reader 遇解码即抛错。未读取用户原件或连接 5432 开发库。正式迁移、隔离注入器与保存的状态证据已经只读核对，审查者未连接数据库。

## 必要修复与失败记账

密集套件首次清理仅删除 Artwork，遗留 891 条被置空归属的合成 Image。现收集本次 imageIds 并在删除 Artwork 前按 ID 删除；此前孤儿也只在专属库按前缀和数量核验后清理。`dense/dense-final-smoke.log` 的最短定向重跑通过，`dense/dense-cleanup.json` 的媒体、作品、run、posting、候选、配对、job、lease 和目录计数均为零，此项已关闭。

首次 100,000 条准备在 66,000 条时因 Docker 虚拟磁盘满失败，尚未进入内核。其后正式数据库 CHECK 在拟提交 200,003 次比较时拒绝写入，保留 199,955 次已提交比较及检查点；该次失败的末尾精确 profile 缺失，未拼入完整冷轮统计。两次失败均保留原日志和现场，不算完成轮。

经主任务授权，只在专属规模库将 `artwork_dedup_relation_cache_bounds` 的两项视觉计数上界由 200,000 改为 10,000,000。已逐字核对旧／新定义，其他非负、原件比较及最多 1,000 候选对谓词完全保留；代码、迁移和普通库没有因此改变。`harness/scale-check-override-and-reset.json` 显示只重置失败 run 的视觉配对、候选、posting、签名和检查点，媒体仍为 100,000、item 仍为 100，工作表和计数归零；新旧 manifest 除七源摘要更新外完全一致。

重放前还发现恢复 SQL 的美元引用起始符被字符串替换折成单个 `$`。实际文件及持久副本均已改为成对 `DO $$ ... END $$`，并以 `BEGIN/COMMIT` 包住检查和恢复，逐字符复核通过，未执行恢复。恢复脚本拒绝错库及仍存在超 200,000 视觉计数的状态；保留超额测试证据期间不得直接恢复原 CHECK，也不能改低计数伪造可恢复条件。

失败计量现由 catch 保存，包含失败事务及回滚；成功扫描先保存 `*-kernel.json`，之后才审计输入和结果。显式 replay 启动要求原输入、原源码及零工作态；每阶段 90 分钟、runner 91 分钟的有限时间保护只属于测试。相关修复只读复核通过后，审查者按主任务已有授权通知开始固定 replay。

## 已完成冷轮的独立文件核对

对 `harness/scale/cold-start.json`、`cold-resume.json`、两个 `*-kernel.json`、manifest 及 `harness/cold-summary.json` 执行只读 JSON 断言；没有重新执行检索。核对结果如下。

| 项目           | 独立核对结果                                                                         |
| -------------- | ------------------------------------------------------------------------------------ |
| 进程恢复       | PID 43317 → 54223；后段初始检查点逐字段等于前段末尾，前缀比较计数为 1,013,777        |
| 全部候选       | 2,789,280 候选槽、1,344,456 次比较、29 个候选作品对；全部边及无重复性逐项匹配 oracle |
| 发布结果       | 两对全部图片 ID、顺序、kind、summary、candidate evidence 及负证据候选一致            |
| 第一对         | 1,000 SIMILAR；每侧 1,000 张，无未配对                                               |
| 第二对         | 800 SIMILAR；每侧 1,000 张、各 200 未配对，共 1,200 条展示明细                       |
| 终态           | `COMPLETE`、无未完成原因，复用比较为零                                               |
| 内核累计       | 5,489,728 ms，2,120,299 SQL，111,909 事务，396,414 写语句                            |
| 查询载入       | 查询／候选／合计最大 8／50／58；guard 最大 48 作品；单次媒体读取最大 1,000 行        |
| 内存           | 两进程采样 heap 最大 73,562,496 B，采样 RSS 和进程 maxRSS 最大均为 190,201,856 B     |
| 结束数据库大小 | 1,294,963,503 B，包含 schema、探针和当前 fixture／工作状态                           |

候选边核对包括 27 个未达到作品配对阈值的候选，不只检查两对已知结果或计数。发布摘要 SHA 独立重算为 `e6a782c7cedcca80356dbf51a79e588d289f1089cf2dba58a41b98cd60ca4e9e`，完整结果摘要亦重算一致。每个 kernel 快照的公共字段与后续结果文件逐项一致，两段 profile 的 statement count 总和恰好等于 2,120,299，事务分阶段汇总恰好等于 111,909。

计量边界已核对：计时、SQL 与 25 ms 采样包围扫描调用，排除生成、输入／结果审计及热克隆；进程 maxRSS 包含 Prisma、测试框架和测量前活动，不含 PostgreSQL 服务内存。写语句包含无新增效果的写操作，不等于新增行数。51 作品／58 特征限额的采集调用不会把最终发布的 100 作品或扫描后的摘要审计误算成 QUERY 批次。

独立重算 Prisma event duration 合计为 2,872,923 ms，其中同时涉及 Media／Item 的 223,547 条语句累计 2,584,788 ms，占 89.97%；QUERY 事务 wall 合计 5,308,542 ms。event duration 为 Prisma 整数毫秒，事务 wall 含客户端、往返和等待，均不能解释成纯数据库 CPU。91.50 分钟仅为此预制特征冷轮观测，未据此声明性能门槛达标。

## 完整热轮的增量核对

只读核对 `harness/scale/hot.json`、`hot-kernel.json`、`hot-identity.json`、完整 `harness/scale-replay.log` 与 `harness/final-source-verification.json`，不重复冷轮或检索。PID 74671 使用新 run，检查点明确固定原冷 run 为 reuseBase，29 个候选全部物化后完成；输入 SHA 与七源摘要逐项保持不变。kernel 快照的公共字段与最终结果文件完全一致。

最终为 `COMPLETE`、无未完成原因，0 次新比较、1,344,456 次关系复用。29 个候选全部 `reused=true`、edges 为空；每个 candidate evidence 与冷轮逐项相同，包括 27 个负证据候选。两组全部发布图片、kind、顺序及 summary 与冷轮和 oracle 完全一致；发布摘要仍为 `e6a782c7cedcca80356dbf51a79e588d289f1089cf2dba58a41b98cd60ca4e9e`，完整结果摘要亦独立重算一致。

| 项目                           | 热轮独立核对结果                                                             |
| ------------------------------ | ---------------------------------------------------------------------------- |
| 内核 / Vitest 阶段             | 5,276,663 ms（87.94 分钟）/ 5,312,346 ms（88.54 分钟），原 90 分钟上限内完成 |
| SQL 总事件 / 阶段归因          | 2,119,612 / 2,119,611，差一条 COMMIT，见下文                                 |
| 事务 / 写语句                  | 111,962 / 395,804；分阶段事务数及 INSERT、UPDATE、DELETE 合计精确相符        |
| 采样 heap                      | 79,274,232 B                                                                 |
| 内核区间采样 RSS / 进程 maxRSS | 207,601,664 B / 217,202,688 B；后者还含进入内核前的热克隆等活动              |
| 有界载入                       | QUERY 最大 8／50／58，guard 最大 51 作品，单次媒体读取最大 1,000 行          |
| 数据库大小                     | 2,017,948,463 B；包含保留的探针、冷热输入及工作状态                          |

热轮 raw listener 记录 2,119,612 个事件，阶段 profile 仅归因 2,119,611 个：BEGIN 为 111,962，COMMIT 为 111,961，没有 ROLLBACK。profile 事务数与写语句数完全一致，结果也已完整提交；差异限于一条 COMMIT 未进入阶段统计。没有保存逐事件时序，不能断言具体哪笔或补造归因。主记录保留 raw 总数并说明此缺口，不要求为此修改源码或重跑长测。

热轮阶段归因 duration 为 2,665,290 ms，Media／Item 联查累计 2,392,655 ms（89.77%）；QUERY 事务 wall 为 5,099,615 ms。热轮 SQL 比冷轮少 687 条，内核耗时低 3.88%，不能把零比较理解为已消除数据库成本。此轮仍重建索引、查询当前候选并核验提交身份，仅证明 READY 预制特征的关系复用正确，不证明原图解码、特征缓存或真实图库全链吞吐。

## 密集、探针及桌面证据

密集七个不同用例按“首轮六项通过，比较预算预期修正后该项通过”核对，未把 skipped 或多次 smoke 重复计数。99 条 fixture 在 174 个持久让行边界逐项验证前缀，覆盖 8 查询与 90 候选跨 50 槽的内页游标；四类硬预算均 `DONE + INCOMPLETE`、不发布半成品，原样重入不升额。旧 executionVersion 和真实过期 lease 在密集后缀读取后均零状态提交；新版本／新 token 接续完成。此处不要求新增硬预算续行协议，也不把同进程 fresh context 当作 OS 重启。

5,000 条探针的三个独立 PID、同输入摘要、相同持久检查点、全部边和冷／热发布摘要已经核对。冷轮 20,340 次比较，热轮零比较、20,340 次关系复用。probe 执行后加严的 summary／evidence 断言另外对保存结果做只读审核，未将其说成重跑 probe。READY 特征及 `visualAfterImageId` 跳过特征准备，因此热证据只证明关系复用；“冷”也不代表 PostgreSQL buffer cache 冷。

已核对 `browser/report.md`、`audit-final.json`、控制 HTTP 行、进程记录及正常图片对照／刷新后未完成提示截图。正常 30 张样本发布一对，8 相近、双方各 2 未配对；真实解码的 502 张密集样本在 INCREMENTAL 和唯一补验 FULL 中均自然达到 `VISUAL_POSTING_BUDGET`，`COMPLETED/DONE` 与 `visualStatus=INCOMPLETE` 同时成立，无候选／发布对，界面明确提示未全部检查。532 个文件的 SHA、inode、大小及未变化标记与报告一致，删除 operation 为零。

桌面四次暂停请求均为 HTTP 409，未计为暂停成功；本批不能独立声称暂停／继续成功。当前未改控制实现，执行记录明确引用第三批已有证据。该限制与真实图库、NAS、强杀回收、50 万规模、解码吞吐和实际删除等未覆盖范围均保留，不扩大本轮测试。

## 资源、保留与审查边界

`harness/final-process-audit.json` 记录 runner session 79018 正常退出 0、热轮 PID 74671 已退出，本轮剩余进程为空。`harness/final-db-session-audit.txt` 为 0：仅统计本专属库全部其他会话，不限 active／idle，排除审计自身；已核对实施者提供的 `pg_stat_activity` 过滤口径，没有借此宣称其他库无会话。桌面 App／Worker 的退出证据已在前述 browser 审查中核对；不为测试收口停止原有隔离 PostgreSQL 容器。

已核对本次新增的 [TODO](../../TODO.md)、[后续计划](../design/artwork-deduplication/matching-extension.md)、[记录入口](./README.md)及主记录的保留边界。专属规模库保留原作品／媒体 ID、输入和结果，并保留测试 CHECK 额度用于后续同样本比较；不用于 App、开发图库或生产，当前不执行恢复脚本。后续优化根身份／目录清单重复推导仍须保留提交时的身份、代次、写声明和执行权校验。硬预算续行、50 万、真实解码、NAS 与业务争用保持待授权目标，本批不继续实现。

本次审查只读取源码和保存文件，并用 Node 对 JSON 做断言、摘要与统计重算；未运行数据库、媒体、浏览器或全量构建／测试。实施方 typecheck 日志已读，其通过不等同本审查者重跑。主任务统一完成文档链接检查（296 份 Markdown）、图示检查（33 图源、23 内嵌块）及主应用路径大小写检查；本增量审查没有重复这些检查。
