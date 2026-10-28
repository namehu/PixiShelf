---
status: historical
scope: F03 第五批 legacy 修复验证、目录范围缓存与同样本 100k 冷热证据独立审查；不代表生产吞吐或 50 万验收
last-verified: 2026-10-28
sources:
  - packages/pixishelf-db/src/artwork-dedup.ts
  - packages/pixishelf-db/src/artwork-dedup-review.ts
  - packages/pixishelf-db/src/artwork-dedup-operation.ts
  - packages/pixishelf-db/prisma/migrations/20261027000300_artwork_dedup_legacy_review/migration.sql
  - packages/pixishelf-job-executors/src/artwork-dedup/executor.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/direct-delete.postgres.test.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/root-directory-scope.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/visual-batches.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/root-directory-scope.postgres.test.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/visual-batches.postgres.test.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/visual-scale.postgres.test.ts
---

# F03 第五批独立审查

## 范围与结论

2026-10-28，独立审查者按用户指定的 Sol 6.1 / xhigh 检查 `912f7e73..46eacb5b`，包含 `73ebb3b7` 与 `46eacb5b` 两次初始版本证据修复；主线程随后合入为 `2af6ff4a`。再以该提交为基线，独立检查第五批两个生产文件、两个定向测试文件及规模测量入口的增量。本次不泛化重审既有去重系统，不修改产品或测试源码，不连接开发数据库或用户媒体。

两次修复未发现阻塞问题，可作为第五批基础。`git diff --check 912f7e73..46eacb5b` 通过；此结论与实际测试结果分别记录。

## 前置修复审查依据

- 当前 `ArtworkContentSource` 缺失时按版本／代次 0 校验，与 `captureArtworkContentSnapshot` 一致。默认值不作用于历史 item、操作快照或指纹：null、负值和非零快照不能因缺失源记录而通过；源及指纹版本／代次另受 `NOT NULL` 与非负约束保护。缺少指纹、写入占用、内容摘要或归属变化仍拒绝。
- 审核 SQL、维护清单和操作快照复核已采用相同语义。预览逐页读取与提交、预览完成、删除授权、claim、首次删除及最终提交均调用同一快照复核。文件级源版本、根身份、目录代次、写入声明、来源保护及删除回执未放宽。
- 将新迁移与 `20261026000100_artwork_dedup_partial` 中旧函数机械比较，函数逻辑唯一变化为四处当前源版本／代次使用 `COALESCE(...,0)`；返回结构和其余资格／推荐逻辑一致。迁移仅 `CREATE OR REPLACE FUNCTION`，不更新业务数据、历史审核或授权。旧 run 已标记 `CHANGED` 的作品仍需重新检查。
- 新 CI 专用步骤显式配置 `QUEUE_KERNEL_TEST_DATABASE_URL`，启用五个数据库套件及八个 EXACT／CONTAINS × 四种来源的 legacy 原件删除用例。普通 Worker 测试步骤仅配置 `DATABASE_URL`，因此 `executor.postgres.test.ts` 中新增的三个结果／消息断言仍默认跳过；本次隔离定向验证另行显式运行。未据工作流配置推断远端 Actions 已通过。

## 旧规模基线的可比性

两次修复没有修改 `visual-batches.ts`、`visual-pipeline.ts`、`visual-matching.ts`、`visual-experiment.ts` 四个生产视觉执行文件，也没有修改视觉 DB guards。第四批 100k harness 直接调用 `scanBatchedVisualVersions`，不经过最终 `buildArtworkDedupGroups` 或任务完成消息，因此旧内核基线可保留，无需重跑旧版完整长测。第五批仍须记录新源码与迁移基线，并在相同输入和 oracle 上验证结果及有界行为；旧性能数字和限制以[第四批记录](./artwork-deduplication-scale-f03-2026-10-27.md)为准。

## 隔离定向验证

在合入提交 `2af6ff4a` 上，仅使用 `127.0.0.1:55432` 新建的 `dedup_f03_roots_legacy_20261028`，通过正式 `pnpm --filter @pixishelf/db db:deploy` 应用 126 项迁移，全部完成。运行器为 macOS arm64、Node 20.19.4、pnpm 8.15.9；数据库为独立容器内 PostgreSQL 15.14。运行时注入明确测试连接，不回退读取应用环境文件，不在记录保存凭据。保留 100k 库与 5432 开发库不参与；原件全部来自测试生成的临时目录，没有读取用户媒体或访问真实外站。

复用已有 `packages/pixishelf-worker/dist/artwork-dedup-native.node`，未构建 native 或共享包。以下命令均显式注入 `DATABASE_URL` 与 `QUEUE_KERNEL_TEST_DATABASE_URL` 指向上述新库，按顺序运行，退出码均为 0：

```bash
pnpm --filter @pixishelf/db exec vitest run src/__tests__/artwork-dedup.postgres.test.ts src/__tests__/artwork-dedup-review.postgres.test.ts -t legacy --no-file-parallelism --reporter verbose
pnpm --filter @pixishelf/job-executors exec vitest run src/artwork-dedup/__tests__/direct-delete.postgres.test.ts -t 'legacy zero-version' --reporter verbose
pnpm --filter @pixishelf/job-executors exec vitest run src/artwork-dedup/__tests__/executor.postgres.test.ts -t 'persists visual features|hashes every complete inventory|missing originals stay incomplete' --reporter verbose
```

| 定向范围                                   | 通过 | 名称筛选跳过 | 失败 | Vitest 耗时 |
| ------------------------------------------ | ---: | -----------: | ---: | ----------: |
| 新增 legacy 分组／审核／预览及迁移兼容     |   26 |           18 |    0 |     2.52 秒 |
| EXACT／CONTAINS × 四种来源的原件删除全链路 |    8 |           43 |    0 |    25.11 秒 |
| executor 三种完成消息及计数                |    3 |           61 |    0 |    10.65 秒 |
| 合计                                       |   37 |          122 |    0 |           — |

跳过均来自明确的名称筛选，不计作执行通过。本次不重跑五个数据库套件的全部历史用例，不是应用全量或生产验收。Worker 依赖链 typecheck 留待主线程最终统一执行，本审查未运行。

### 清理与证据

测试后只读审计发现 31 条 `Image` 及对应 `MediaContentSource` 孤儿记录，均属于同一 `dedup-review-*` 合成前缀：既有审核套件 `afterAll` 删除 Artwork、未先删除 Image，外键置空后留下这些记录；另有两个 `test` provider、`https://example.test/prepare-executor-*` 的合成删除身份。未修改产品或测试源码；先保存精确 ID／路径／身份清单，再仅在本次新库按该清单清理。临时清理脚本首次只读预览因 externalId 格式保护拒绝，零数据变更；按 fixture 源码确认完整前缀后，预览与精确清理均成功，原日志保留。所有测试生成的临时媒体由 fixture 终结清理。

最终逐表只读审计确认业务表零残留；仅 `_prisma_migrations` 的 126 行和迁移初始化的 `archive_resolve_queue_control` 一行保留。126 项迁移均完成且无回滚，其他数据库会话为 0；审计进程随后断开自身连接，新库保持空闲。测试前后上述四个 legacy 生产文件及既有 native 产物 SHA-256 一致。没有重置或修改保留 100k 样本。

原始证据位于 `/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-f03-roots-20261028/review/legacy/`：`migrations.log`、`db-legacy.log`、`direct-delete-legacy.log`、`executor-result.log`、清理前后审计 JSON、精确清理清单与临时脚本。迁移与测试日志、失败保护预览和最终清理证据分别保留，不把清理后的空库计数当作测试过程快照。

## 第五批实现审查

对冻结的 `visual-batches.ts`、新增 `root-directory-scope.ts` 及对应两个 PostgreSQL 测试文件未发现阻塞问题。审查未重复执行这些测试；核对实现、既有调用链和 Astra 实际日志，允许在同一源码冻结后进入 5k 探针。此结论不包含 100k 长测结果或吞吐达标判断。

- 生命周期与身份：helper 在 `prepareVisualVersions` 完成后，每次 `scanBatchedVisualVersions` 调用新建，只接入 QUERY 提交。INDEX／REUSE 产生 item 视觉签名后才读取目录范围；生产 VISUAL 路径不改冻结媒体的成员及目录绑定。实例保存 run／job／executionVersion 的副本，条目再绑定当前 item 的完整序列化值，包含状态、成员证据、nullable 字段和更新时间；BigInt 的 0 保留为 `"0"`，不会变成 null。让行或重启获得新实例，不跨进程、run 或执行上下文复用。
- 范围与授权：miss 从当前 run 的冻结媒体读取目录描述，hit 只跳过重复推导。每段 QUERY 事务先取得当前 run／执行上下文，再持 catalog、所涉及的全部根、每批最多 100 个目录及祖先，随后通过原 `assertArtworkDedupVisualItems` 锁 Artwork 并核对源版本／代次、成员及归属。正向与负向候选涉及的作品均在 guard 范围内。helper 的目录检查通过不代表 item 有效；例如 null 快照仍由后续 item guard 拒绝。
- 有界与回退：LRU 最多 128 部作品、2,000 条目录描述、1 MiB 序列化元数据；计数在移除及插入时同步更新。miss 查询最多取 2,001 行；单次或组合范围超过目录／字节预算时回退原分页校验，不截断为前 2,000 行。当前批次每项都不超过总预算，因此逐项淘汰不会出现空 LRU 仍无法装入的循环。
- 事务与变化：LRU 在事务中读取的是不可变输入描述，不缓存成功结论。即使缓存提取所在事务回滚，后续仍重读 item 身份并执行当前根、目录、writer 及 item 校验；候选、比较计数和检查点仍在同一数据库事务提交。已审 rollback 用例是在两段成功提交后回滚缓存命中的下一段，不能称为首次填充回滚的直接测试。取消、执行版本变化、真实租约失效、图片源／成员／媒体代次变化、null 快照、根／目录变化、作品 writer 和目录 writer 均有零推进断言。
- 最终发布：PAIR 和 PUBLISH 保持原调用路径；发布前仍对整个 run 分页复核目录、逐作品当前证据和内容快照。没有加入迁移、公开预算或任务协议变更。

### 已核对的专项测试证据

三份日志累计覆盖 28 个不同用例。首轮为 19 通过、6 失败、11 名称筛选跳过；6 项失败均发生在 scope fixture 创建任务时，默认 priority 100 触发 `system_jobs_dedup_policy`，尚未进入被测 helper。fixture 改为契约要求的 priority 900 后，这 6 项全部通过。随后新增／补强的媒体代次、null 快照及事务回滚三项全部通过。它们是分轮修复后证据，不能写成一次全绿；未选择的历史用例不计作执行通过。

专项覆盖 102 个目录跨两根的锁序与实际 catalog 竞争、0／null 和完整 item 身份、LRU 第 129 项淘汰、2,001 目录及 1 MiB 超额回退、目录重条目淘汰和组合批次超额。20 页合成样本的连续调用只推导一次目录范围；每三次检查点提交让行、共四次 scan 调用后推导三次，完整边、候选、发布结果、检查点及计数与连续调用相同。该小样本说明生命周期和结果等价，不代表真实 Worker 或 NAS 吞吐。

日志已从临时目录复制到证据根 `review/scope/`：`root-scope-tests.log`、`root-scope-tests-retry.log`、`root-scope-final-cases.log`；五个受审源码及三个测量 helper 的 SHA-256 保存于 `source-review.json`。本次审查未重测，也未运行主线程统一负责的 typecheck／构建。

主线程首次 Worker 链 typecheck 随后发现 helper 的 `entry?.identity === identities.get(id)` 没有令 TypeScript 将 `entry` 收窄为 `Entry`（TS2345）。Astra 仅将该行改为显式 `entry && entry.identity === identities.get(id)`；独立复审逆替换后精确还原首审 SHA，确认无其他代码变化。当前 item 集合已按同 run／ids 查询并核对完整数量，身份映射对合法条目存在；新判断保留合法命中，明确缺项为 miss。最终 helper SHA-256 为 `f13bbb48e33d6f620cb1874cfa1c537be74891ad07d8fb3ddfbe6d3614fbb047`，可用此版本冻结进入探针。前后 SHA 和单行复审保存于 `type-narrowing-review.json`；没有重跑先前 28 项，也没有把首次 typecheck 失败写成通过。受影响 executor／worker 类型补验及最终构建由主线程登记。

## 测量入口增量审查

`visual-scale.postgres.test.ts` 的增量和三个准备／冻结／执行 helper 未发现阻塞问题，可以冻结后运行 5k 探针。受审测试文件 SHA-256 为 `6d403bba0ab7907cffb5877c85c51e25c9fa4a39a2871b5a72cb786d6cbb275a`。

- 准备器与测试入口都限制精确 `127.0.0.1:55432/dedup_f03_scale_kernel_20261027`；执行器强制复用已准备 fixture，不调用旧库初始化或重置入口。新的 FULL 只复制 item／冻结媒体，沿用原 Artwork／Image ID、SHA 和特征，清除新 item 的视觉签名，从零 posting／候选开始；旧 run 的工作结果保留。
- 仅经主线程授权，将已 `DONE / visualStatus=COMPLETE` 且原输入、发布摘要、候选证据均匹配的两个旧合成 hot run 的 `status` 收口为 `COMPLETED`；`updatedAt` 自动更新，`relationCacheVersion` 仍为 null。没有把旧 hot 造为可复用缓存，或改写旧工作／结果。准备审计记录新 100k FULL 为 `922132e6-b144-4fe9-aa6d-8c2eb370a63f`，输入仍为 `b19735b712c996b45339eb90a85e4ba3c07395fbe1368d314052b31074cea60a`，未新增原作品／图片；5k 新 FULL 为 `3866f090-058c-4b04-af61-e16f9a9dc633`，输入摘要变化仅因旧 probe 未含目录而新口径纳入目录状态，两个摘要分别保留，不能把它们写成相同 SHA。
- 测量断言冷轮 `reuseBaseId=null`，热轮必须复用本次新 cold；比较／复用计数、全部候选含负证据、发布对象及完整摘要同时对独立 oracle 和历史证据核对。热轮不靠任意历史 run 形成“零比较”结论。
- 冻结前 manifest 标为 pending，测试拒绝该状态；冻结器加入第八个 helper 源文件及五个关键 DB guard 的哈希。跨进程测试会重新比对八个执行／测试源码；DB guard 哈希由冻结记录及 scale 冻结时与已完成 probe 的同源比较约束，冻结后也必须保持不变。scale 冻结要求同源 5k probe 已 complete；执行器另要求独立的 100k 长测授权位，不将本次静态审查自动升级为长测授权。
- 测量继续沿用旧 cold-start／不同进程 cold-resume 的让行模式。5k 仅跑这两段，不新增 probe 热轮；100k 再跑完整冷热轮。内存目录缓存只在单次 scan 调用中有效，不能据长调用测量宣称 Worker 全链时间片具有相同命中率。

已核对 `harness/` 下的 schema-before／after、两份旧 hot 收口记录、scale／probe preparation JSON 及保存的 helper 源码。126 项迁移中的新增审核函数已应用，专属规模库原有测试比较计数 CHECK 保持不变。审查时两个 prepared manifest 均尚未解冻，未启动探针或 100k；后续实际测量结果由主记录汇总，本记录不得提前作为规模验收通过证据。

## 首次 5k 探针与统计诊断的增量评估

探针随后在冻结源码上完成，两段冷轮均正常退出，功能及独立 oracle 全部通过：20,340 次比较、0 次关系复用、200,000 条 posting，完整候选、负证据、配对与发布结果匹配旧基线；发布 SHA 仍为 `40b48b49ac97a387034413da40873d58f48d02da0163f86cf4874dde59cc2700`。但完整内核 wall 为 447,844 ms，明显慢于旧同 ID 探针的 58,521 ms，必须保留为性能回归观测，不能写成整轮加速。

新增完整探针有 87,589 条 SQL、5,451 笔事务、14,091 条写语句；旧探针分别为 42,517、2,069、7,484。未改动的 posting SELECT 执行 5,000 次，Prisma event 累计 329,903 ms，约占新 wall 的 74%。单页变慢也令每次 100 ms 查询组装预算容纳的页数变少，放大了事务和其他 SQL 数；不能把全部计数差异直接归于目录 helper。首段目录范围推导实际为 11 次／18 ms，旧根／目录推导为 984 次／1,912 ms，证明目标路径的重复工作确有减少，但不能抵消整轮回归的事实。原始证据为 `harness/probe-summary.json`、两段 kernel/profile 和 `probe-runtime-diagnostics.json`。

主线程仅授权在专属规模库对 `ArtworkDedupVisualPosting` 执行一次 table ANALYZE。独立审查者未执行数据库操作，随后只读核对 `posting-statistics-recheck.json`：

| 同一单页 posting 读取          | ANALYZE 前                              | ANALYZE 后                       |
| ------------------------------ | --------------------------------------- | -------------------------------- |
| SQL／参数／结果                | 同 SQL、43 个参数；85 行、结果 SHA 一致 | 同左                             |
| 主键索引条件                   | 仅 runId，key 在 Filter                 | runId 与 key 同时进入 Index Cond |
| 过滤掉的行                     | 199,915                                 | 无同类过滤                       |
| shared hit blocks／read blocks | 202,362／0                              | 248／0                           |
| EXPLAIN ANALYZE execution      | 136.634 ms                              | 1.177 ms                         |
| 五次普通 SELECT wall           | 65.78–73.31 ms                          | 2.64–3.60 ms                     |

表统计原有四个 run 的最常见值，没有本次 probe run；刷新后变为五个并纳入它，`n_mod_since_analyze` 从 200,000 归零。全程只分析一次表，没有 VACUUM 或业务数据修改，没有改源码、索引、预算或强制执行计划。两侧均全为 shared hit、read 为 0；同参数结果不变且计划扫描工作量大幅减少，足以支持统计缺失是该单页退化的原因。它仍是单页诊断，不是刷新后的完整探针耗时，不能与旧 profile 拼接。

### 最小可信下一步

此阶段的独立准入结论为**无阻塞，可由主线程另行放行一次正常 100k 冷轮／不同进程续跑和热轮；不要求再完整跑一轮 5k**。5k 已证明功能等价；对已被人工 ANALYZE 纳入统计的同一 run 重跑，只会测到另一种统计环境，不能回答下一个新 run 在 INDEX 后能否自然获得合理计划。主线程随后授权 harness 按此边界执行一次，完整冷热结果现已按下节通过最终定向核验；本审查者没有启动测量。

当前配置为 autovacuum 开启、analyze scale factor 0.1、threshold 50、naptime 60 秒、statistics target 100，表无单独 reloptions。刷新后的分析阈值约 860,046 行；下一冷轮 INDEX 预计插入 4,000,000 行，超过阈值，但并不保证在 QUERY 开始前完成自动分析。本次诊断核对时新的 100k run 尚未在 posting 分布中，不能由现有 5k 的计划恢复推断它已恢复。

保持源码／预算冻结，不在新 cold 或 hot 的 INDEX 后人工刷新统计。最小只读 observer 在 INDEX 末端和首次 QUERY 各保存一次统计、检查点及有界 EXPLAIN；若首次 QUERY 仍为仅 runId 索引条件、key 过滤整 run 的退化计划，最多观察 180 秒（约三个 naptime），到点仅再复核一次。若计划仍退化且单页耗时／进度持续异常，保存已提交的检查点、计数、时间及现有进度日志，停止本次测量，不等 90 分钟。若计划已自然恢复且进度正常，继续既定的一次完整运行，不扩展采样矩阵。冷／热轮采用同一停止规则。

若 harness 没有外部让行入口，不为此再改冻结源码；保存证据后终止该次测试进程，并如实登记“诊断中止的测量”。不能称为真实 Worker 暂停成功，也不能重置计数、删去退化前段或将终止前后片段拼成未中断的正常 wall。

后续结果必须并列说明首次 447,844 ms 观测及一次全表 ANALYZE 的环境变化。即使正常 100k 最终通过，也只证明这一环境下的大 run；已有大量历史 posting 时，小型新 run 低于自动分析阈值而长期错估的风险仍然存在。本批根／目录优化不等于该 posting 计划风险已被产品修复，生产吞吐不能由人工分析后的单页或大样本推断。

## 最终证据增量复核

本节复用先前实现／安全审查与已执行测试，只读取已落盘结果，不重跑测试、不连接数据库、不重做全量源码审查。完整冷／热轮、源码冻结及最终退出证据均已独立核对，结论为**本批有界根／目录查询优化通过，无未解决阻塞项**。该结论不包括生产吞吐、50 万规模或小型新 run 的 posting 计划修复。

### 冷轮、冻结与观测边界

独立复核直接比较新旧 `cold-resume.json` 的整个 `outcome` 对象，包含全部候选及负证据、边、配对、完整 evidence、发布对象和计数，逐项完全一致；另从对象重算 published／complete SHA，与两轮保存值相同。新 cold-resume 的 `initialCheckpoint` 精确等于新 cold-start 的最终检查点。首段比较数为 1,013,778，最终为 1,344,456，续跑增量为 330,678；旧首段少一次比较，只能比较完整冷轮，不能把两个前缀视作同一工作量。

从两段原始 `measured` 独立加总，内核耗时为 1,891,887 ms（839,128 + 1,052,759），SQL 1,785,408、事务 111,907、写语句 284,833。归因 profile 合计确为 1,785,407，与原始 SQL 相差一条；保留该缺口，不指定或补造缺失语句。QUERY 根／目录 DISTINCT 独立求和为 94 次／490 ms，历史相同口径为 167,364 次／2,550,583 ms；INDEX／PAIR／PUBLISH 的旧路径仍在，不能把这两个 QUERY 数字写成全阶段总量。

输入 SHA 保持 `b19735b712c996b45339eb90a85e4ba3c07395fbe1368d314052b31074cea60a`，发布 SHA 保持 `e6a782c7cedcca80356dbf51a79e588d289f1089cf2dba58a41b98cd60ca4e9e`；完整冷轮 SHA 为 `4f8c564f3ef5c5a8f51f64f041c5e56c1379e400e79dc3de2d7789b8d5813095`。八个执行／测试源码和五个 DB guard 的当前文件 SHA 均与正式 manifest 一致。实测最多 8 条查询特征、50 条候选特征、58 条合计特征，单批 guard 最多 48 部作品；单作品读取仍不超过 1,000 条。独立计算保存于 `review/scope/final-cold-review.json`。

冷轮 INDEX 末段 380 万 posting 的快照确为 INDEX，自然 autoanalyze 已从 10 次增至 12 次；QUERY 早段计划同时使用 runId 和 key 索引条件，没有再人工刷新统计。热轮原意在 INDEX 末段采集的快照实际已到 QUERY；`scale-hot-index.json` 和 `scale-hot-query.json` 逐字节相同，只算一次 QUERY 早段观测，不能宣称热轮捕获了精确 INDEX 快照或两次独立观察。该快照的 autoanalyze 已到 14 次，人工 analyze 次数仍为 1。

旧冷轮耗时 5,489,728 ms，新轮较低，但内存没有全面改善：采样 heap 峰值 73,562,496 → 83,306,328 B，采样 RSS 190,201,856 → 195,592,192 B，新进程 max RSS 为 197,640,192 B。这些数值包括测试框架和进程准备，不是目录缓存单独占用。历史表规模／统计与本轮不同，且主线程登记本轮导入／早期 INDEX 与唯一图示检查有数十秒 CPU 重叠；保留原计时、不扣除重叠、不重启挑选有利结果，不作为严格单变量多轮 A/B。

### 同源构建与真实桌面链路

已核对主线程原始日志：第一次 Worker 依赖链中 contracts／db／runtime 类型检查通过，executor 因上述 TS2345 失败；单行修正后仅补 executor／worker，二者通过。唯一一次 Worker 依赖链构建完成，三条既有 import.meta／CJS 警告保持登记；没有将首次失败或有警告构建写成一次无问题全绿。

独立复核 `browser/build-identity.json` 中唯一 Worker 产物及两个生产源摘要，均与当前文件和规模冻结源一致。浏览器最终审计支持一次实际 ABC FULL：30 个原件读取 402,756 字节，A/B 完整 summary 和全部配对／未配对页与旧结果完全一致。已直接比较最终审计中的两个完整 pair 对象，没有重复执行浏览器。532 个合成文件的 unchanged 标记、5 部作品的 ACTIVE／未删除状态均成立。

打开并关闭确认面板产生的操作确为 PREPARE／READY／DONE；删除授权及开始时间均为空，移动／删除均为零，不能称关闭面板已取消后端操作。该浏览器库最终会话为零，自建 App／Worker 已退出。此项证明同一产物的真实队列、读取和页面链路，不代替 100k 实际解码、NAS、移动端、故障恢复或本轮没有再次执行的删除测试；37 项 legacy 专项与 28 项根／目录专项仍按各自实际范围引用。

### 热轮与最终收口

热轮一次完整运行的 `outcome` 已与旧热轮整个对象逐项比较一致，并独立重算 published／complete SHA。其候选对和完整 evidence 与本次冷轮一致，发布对象与本次冷轮完全相等；复用工作对象按契约保留 `reused=true`、`edges=[]`，没有把它描述为与冷轮工作对象逐字段相同。热轮完整 SHA 为 `bc1cd1a6f2d975a0789c1b7bf35f527ac09c76303086ce8cc99132045a51943e`，发布 SHA 仍为 `e6a782c7cedcca80356dbf51a79e588d289f1089cf2dba58a41b98cd60ca4e9e`。`reuseBaseId` 精确指向本次新 cold `922132e6-b144-4fe9-aa6d-8c2eb370a63f`，0 次新增比较、1,344,456 次关系复用、29 个候选对、2 个发布对，不借用旧 hot 伪造命中。

| 热轮复核项              |        旧基线 |          本批 |
| ----------------------- | ------------: | ------------: |
| 内核 wall               |  5,276,663 ms |  1,916,235 ms |
| 原始 SQL                |     2,119,612 |     1,784,816 |
| profile 语句数          |     2,119,611 |     1,784,816 |
| 事务                    |       111,962 |       111,966 |
| 写语句                  |       395,804 |       284,242 |
| QUERY 根／目录 DISTINCT |    167,358 次 |         73 次 |
| 上述语句 event 累计耗时 |  2,385,364 ms |        217 ms |
| 采样 heap 峰值          |  79,274,232 B |  69,926,552 B |
| 采样 RSS 峰值           | 207,601,664 B | 183,500,800 B |
| 进程 max RSS            | 217,202,688 B | 204,439,552 B |

新热轮 raw／profile 无缺口，旧热轮历史单条 COMMIT 缺口与新冷轮单条未归因缺口均继续保留。冷／热实测 guard 上界分别为 48／51 部作品，两轮均符合 8／50／58 特征读取边界，单作品最多 1,000 条。热轮零新增比较仍伴随完整索引、候选查询与现验；约 31.94 分钟的实际开销不能解释为“零计算”或通用缓存吞吐。

最终八个源码与五个 DB guard 再次与 manifest 核对一致。`final-resource-audit.json` 记录 runner 正常 exit 0、没有本任务残留进程，精确规模库的其他活动及空闲会话均为零，审计自身随后断开。新 cold 为 `COMPLETED / DONE / COMPLETE`；新 hot 合成记录仍为 `RUNNING / DONE / COMPLETE`，因为该内核 fixture 不执行真实 Worker 的终态收口，不能据此推断进程还在运行，也不能把它称为真实队列任务已 COMPLETED。库大小 3,930,657,583 B 包含旧／新全部样本及工作证据，不是本轮新增写入字节数；专属库保留旧／新全部样本及 10m 测试 CHECK，正式迁移与生产预算未变。

已核对主记录的冷热表格、归因数字和边界，以及 TODO／matching-extension 中保留的新 run 计划稳定性及其余规模待办，均与实际证据相符。后续仍需验证真实 Worker 十秒时间片、50 万、原图解码、NAS、并发业务及生产小 run 冷统计计划；公开 10,000 上限、匹配及删除规则未改变。先前 5k 性能回归、一次人工统计诊断、正常大 run 自然统计、热轮观测缺失和早期 CPU 短重叠全部保留，不以最终通过覆盖不利观测。

独立冷热重算分别保存于 `review/scope/final-cold-review.json` 和 `final-hot-review.json`；原始结果、kernel/profile、冻结与退出审计见 `harness/optimized/`、`metrics.json`、`final-source-verification.json`、`final-resource-audit.json`。审查者未增加测试、浏览器运行、源码修改或数据库操作。此前本记录的链接检查已通过；最终整合文档检查、diff 检查与提交由主线程统一完成，不重复图示或全量应用检查。
