---
status: historical
scope: F03 第六批 posting 查询实现、fresh run A/B 和完整小任务证据独立审查；不代表生产吞吐或 50 万验收
last-verified: 2026-10-28
sources:
  - docs/design/artwork-deduplication/visual-batches-f03-contract.md
  - packages/pixishelf-job-executors/src/artwork-dedup/candidate-postings.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/visual-batches.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/candidate-postings.postgres.test.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/visual-batches.postgres.test.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/__tests__/visual-scale.postgres.test.ts
---

# F03 第六批独立审查

## 范围与当前结论

2026-10-28，按用户指定的 Sol 6.1 / xhigh 独立审查，以 `7ccd4948` 为基线。实现由 Astra 负责，测量由另一位 Sol 负责；审查者未参与实现，不修改产品／测试／测量源码，不连接数据库、不启动测量或重复测试，不操作主目录、开发库或用户媒体。文档归属仅本记录，不提交。

**本批独立审查 PASS，无未解决阻塞项。** 冻结实现、同一 fresh run 的 5,000 次旧／新 SQL 对照、完整新冷轮／新进程续跑／热轮、统计不变及最终退出证据均已核对。结论限于本次支持环境与固定样本下的新 run posting 查询修复，不扩大为生产吞吐、50 万或任意数据分布的性能承诺。不重新审查第五批不变的目录缓存、认证／删除链或全量代码，也不重复 100k、全量应用或桌面验证。

## 方案与实现审查

最小实现为 `VALUES` 去重 key 输入，`CROSS JOIN LATERAL` 逐 key 以 runId／key 标量等值读取现有主键，内层按 imageId 排序、内外均使用 `VISUAL_LIMITS.queryPostings + 1`，外层不排序。放弃递归 key-walk，不增加 schema、索引、planner 设置、自动维护配置或产品中的 ANALYZE。

- **预算和完整性：** posting 预算是命中行的 multiplicity 总和，候选预算才按 imageId 去重。DB 约束 multiplicity 为 1..4，不能用 DISTINCT imageId 或先聚合候选替代原 posting 权重。令原预算 B=20,000、哨兵 C=B+1：返回少于 C 行时，全部 key 桶已耗尽，集合完整；返回 C 行时，正 multiplicity 保证权重超过 B，调用方只能走 `VISUAL_POSTING_BUDGET`。任意内层桶超过 C 行也会令外层到达 C，不能以部分成功发布。即使少于 C 行而权重超过 B，原逐行累加仍拒绝。超额对象不进入候选游标或发布，不必保留旧 ORM 的隐含 posting 顺序。
- **输入与候选排序：** 去重只作用于输入 key；同一 imageId 命中不同 key 时仍保留各 posting 行和权重。最多四个合法 view、十个 region、四个 band，共不超过 160 个唯一 key，与原特征校验一致。空 key 不查询；完整命中后仍由原 `allIds` 数字升序排序，不受 VALUES 顺序影响。最后一个 key 的命中不能遗漏。
- **读取上界：** 一个查询只进行一次数据库调用。内层 LIMIT 保持参数化 key seek，外层 LIMIT 按需停止；没有全局 Sort 将最多 160 个桶全部物化。独立小库计划证明密集首桶和跨桶两种情况实际合计仅读取 20,001 条索引记录，分别消费 1／3 个 key，而不是 key 数乘以 20,001。
- **接线与生命周期：** `visual-batches.ts` 只新增 import，并在同一受 run 围栏保护的读取事务中替换原 `findMany`。旧 `queryImageId` 恢复分支直接使用持久 `queryCandidates`／`candidateAfter`，不再读取 posting 或重算已提交预算。8 查询、50 候选槽、51 作品和 100 ms 组装边界未变；早先合法前缀、比较／边／游标的原子提交、取消／租约及当前根／目录／作品／成员／writer 校验和最终 PUBLISH 路径未改。
- **参数与投影：** runId、key 和 LIMIT 均通过 Prisma 绑定。helper 只返回下游使用的 imageId／multiplicity；旧 ORM 还返回未使用的 runId／key。因此测量收益包含投影减少，不能全部归于执行计划变化。

冻结 helper SHA-256 为 `cbd36c15187284148ba78728e7881b4ec1b17ad19774818abab4b28bf182d05d`，`visual-batches.ts` 为 `e9acc5c2f8331ad8ed6fe37588d6bf45a9a0c8f70bc022fde61685be03636031`，独立读取后与实现者报告一致。

## 已核对的定向证据

实施者一次执行两个 PostgreSQL 文件：20 项通过、20 项按名称筛选跳过，跳过不算执行通过。其中新 helper 七项，既有批次套件选择十三项。覆盖零 key／160 key／重复 key／同图多 key、20,000 行完整边界和第 20,001 行哨兵、5001 行但 multiplicity 总和 20,004 的溢出、密集跨桶惰性读取，以及未进入历史统计的新 run。批次专项补断言验证数字候选序列、恢复段不重查 posting、空 key 不读取，同时保留源／执行变化、回滚、51 作品后缀及合法前缀预算失败保护。

新 run 陈旧统计用例先在专属小库建立历史 fixture 的统计，再在同一事务中插入未提交的新 run；自动分析也无法把它纳入统计。旧计划只以 runId 定位并过滤 key，新计划为 `Limit → Nested Loop → Values Scan → Limit → Index Scan`，runId／key 都在索引条件，无 Sort。返回的 2,000 条 posting 多重集与旧查询一致。小库探索及测试中的历史 ANALYZE 是复现 fixture 的准备，不能概括为产品修复或保留规模库的统计刷新。

已读取 `/private/tmp/f03-posting-plan-20261028/candidate-postings-tests.log`、`executor-typecheck.log`、`candidate-tests-db-audit.json`，并复制到本轮持久证据的 `review/`。实施者 executor typecheck 通过；专属 `f03_candidate_postings_20261028@55432` 正式应用 126 项迁移，所列艺术家、作品、媒体、源记录、run 工作表、任务、目录及写入声明最终均为零，其他会话为空。审查者未重复执行这些检查。包含后续测量代码的最终类型检查及必要构建也已通过，见末节。

## 测量入口增量审查

`visual-scale.postgres.test.ts` 的增量及三个私有准备／冻结／执行脚本未发现阻塞问题。测试文件冻结 SHA-256 为 `4dcf95a0a9dc673493f0a313082ad560149d5ee63ac226eb48cfec10d10f6bf2`。范围仅保留规模库中的旧／新 SQL 全量 5k 对照，以及一次新实现完整小任务冷轮／不同进程续跑／热轮；不再跑旧完整任务、100k 或浏览器。

- URL 在注入器、准备器和测试中均限制精确 `127.0.0.1:55432/dedup_f03_scale_kernel_20261027`；另一个允许的小库仅用于专项。新 carrier 是 `CANCELLED / VISUAL / PENDING`，只承载只读 SQL 对照，不声称执行过业务检测或通过运行围栏。FULL 与热轮另建 run，不借 carrier 的结果作为业务缓存。
- 准备审计先核对第五批完整 5k 的输入、原 imageId、posting 摘要、候选及发布证据，再仅将 `3866f090-058c-4b04-af61-e16f9a9dc633` 的 status 收口为 COMPLETED，连 updatedAt 也保持原样。独立检查该脚本和保存的 before／after 证明只修改 status；原始输入和工作结果保留。
- carrier `e299c872-198d-42d7-aef8-9f5599db42c2` 包含复制的 200,000 条 posting，摘要与源一致；新 FULL `b02ddcce-cde8-4971-bfd4-689fc98df15e` 从 0 posting／候选／发布结果开始。均沿用原 5,000 个 Image ID、特征和现代输入 SHA `1a6ab5d02163fe67ac84d62dc36343085ee0d18b61414bd8b093bd68afcca7f3`，未新增原作品／图片。后续热轮再建新 run，总计约新增 600,000 posting。
- old／new SQL 在不同进程中读取同一 fresh carrier，排除不同 runId 分布造成的差异。每个进程从固定 5k 特征独立构建恰好 200k 条目的 key-map oracle，对全部 5,000 个查询核对 canonical `(imageId,multiplicity)` 多重集、总权重和数字排序候选 ID；不是只把新结果与旧 SQL 或已发布的两组正例比较。该 oracle 针对本次固定、高信息特征样本，不冒充任意生产图片真值。
- `selectWallMs` 只累计等待 SELECT／helper 的时间，构建 oracle、逐页 digest／断言、事务设置和 EXPLAIN 不在其中；loop wall、Prisma event、EXPLAIN wall 和内存口径分别保存。新旧返回列宽不同、固定 old 后 new 顺序及先前 buffer cache 均是比较边界，不宣称随机交叉或存储冷启动性能。
- carrier 的 old／new 及完整冷／热 run 均保存前后 MCV、last_analyze／autoanalyze、计数和修改行数。准备时保留表统计约 1,660 万行、n_mod=0；复制 carrier 后 n_mod=200,000，autoanalyze 仍为 15、人工计数仍为第五批留下的 1。最终必须从实际结果确认统计没有介入，不能仅因入口检查通过就宣称回归已解决。本轮保留规模库禁止 ANALYZE，不关闭自动维护或强制计划。
- 冻结纳入九个执行／测试源及五个 DB guard，每阶段前后核对哈希；已启动的测量不覆盖重跑。完整路径继续验证 cold 0 复用、hot 只复用本次新 cold、持久检查点接续及全部 oracle／历史结果。hot 启动日志在 clone 前使用 cold manifest ID，实际 hot 身份以 `hot-identity.json` 和 `hot.json` 为准。

point 对照异常时只按已经写入的 initial stats、十秒进度和原始日志说明可证明的前缀，不补造精确末尾 profile；完整内核保留原有 failure profile。这是入口审查登记的边界，本次五个实际阶段均正常退出，未用该边界补造结果。

## 验证范围决定

本轮没有 UI、API、部署、媒体读取或删除协议变化，只有受事务围栏保护的内部 posting SQL 读取替换。因此不增加浏览器验收：以真实 PostgreSQL 的完整集合、multiplicity、预算、续跑、计划和完整小任务等价证明为主要门槛，复用第五批已验证的同一用户流程；不把旧桌面证据写成本轮复跑。无须重复全量应用、100k、真实原图／NAS、50 万或未变的历史安全套件。最终受影响包检查、必要构建及数据证据已按上述范围收口通过。

## 最终测量证据复核

审查者只读取实际 JSON／日志并进行本地对象比较和摘要重算，没有新增测试、数据库连接、测量或构建。持久证据根为 `/Users/namehu/.codex/visualizations/2026/10/22/01a16372-2382-7f93-b679-7e24e38dd6f0/dedup-f03-posting-plan-20261028/`，独立重算保存于 `review/final-evidence-review.json`。

### 同一 fresh run 的 SQL A/B

直接比较 `compare/posting-old.json` 与 `posting-new.json` 的全部 5,000 项结果对象，逐项一致；另重算整个数组摘要，均为 `1732e838b508229ee7680d9c9213fed7376bd6f74756f5d62bb13fa7180165d4`。查询图片 ID 覆盖固定全部 5,000 个 ID，候选槽独立求和为 46,168；每项均包含 rowCount、总 multiplicity、完整多重集摘要及有序候选图片 ID。入口中的逐页实际结果断言全部通过后才写最终结果，不是只比两份预期数组或最终两组正例。

| 同载体 5,000 次 posting 读取 |    旧 ORM 查询 |     新 helper |
| ---------------------------- | -------------: | ------------: |
| 累计 await wall              | 351,728.995 ms |  4,185.419 ms |
| SQL 次数                     |          5,000 |         5,000 |
| Prisma event 累计耗时        |     340,932 ms |        131 ms |
| 采样 heap 峰值               |   85,663,464 B |  89,455,904 B |
| 采样／进程最大 RSS           |  186,368,000 B | 192,593,920 B |

累计候选读取约快 84.04 倍，仅指该同 run、固定 old→new 顺序的候选读取对照，不能作为完整任务加速倍数。新 helper 少返回两个未用字段，收益也包含投影／传输差异；新内存峰值略高，不宣称所有资源改善。计时不包含独立 oracle、结果 canonical 化／断言或 EXPLAIN，Prisma event 也不等于纯数据库 CPU。

两侧保存的首条真实 SQL 及绑定参数用于单独 EXPLAIN，两者均返回 85 行：旧主键只按 runId 扫描，key 为 Filter，过滤 199,915 行、shared hit 202,207；新主键同时按 runId／key seek，执行 40 次、shared hit 245、无 Sort。EXPLAIN 自身 execution time 为 71.224 → 0.326 ms，与上述 5,000 次 await 耗时分别保存。没有以不同 SQL 的参数排列／列宽差异冒充完全相同的语句。

### 统计前提与完整小任务

独立核对 point 两侧及三段完整内核共十份前后统计：所有新 run 均未进入 MCV；人工 analyze 始终为 1、autoanalyze 始终为 15，last_analyze／last_autoanalyze 分别保持 `2026-10-28T01:36:31.204Z`／`2026-10-28T02:20:47.381Z`。SQL 对照 n_mod 始终为 200,000，冷轮后为 400,000、热轮后为 600,000。人工计数 1 是第五批遗留，本轮保留库没有刷新统计或改变 planner／自动维护配置；新查询恢复不能归因于新 run 已被分析纳入统计。

完整新 cold-resume 与历史 5k cold 的整个 `outcome` 对象相等，新 hot 与历史 5k hot 的整个对象也相等；另独立重算其发布及完整摘要。cold 完整 SHA 为 `3584eef1e89345574efe2fa9c0dc795ce6dcfc47eaa99365ba40909072aaff74`，hot 为 `fd2cfb89c0c1a48a9150292da4acac2066dd00914ac1b158e7f4f11df8e2757e`，两者发布对象相等，发布 SHA 均为 `40b48b49ac97a387034413da40873d58f48d02da0163f86cf4874dde59cc2700`。不把冷热内部复用字段和边工作数组不同误报为输出不等价。

| 完整新内核           | 冷轮两进程合计 |      热轮 |
| -------------------- | -------------: | --------: |
| wall                 |      41,042 ms | 43,710 ms |
| 原始 SQL             |         36,170 |    36,127 |
| phase profile 语句数 |         36,168 |    36,126 |
| 事务                 |          2,047 |     2,050 |
| 写语句               |          5,414 |     5,369 |
| 比较／复用           |      20,340／0 | 0／20,340 |

冷轮耗时从原始两段 17,302 + 23,740 ms 加总，比较增量为 11,336 + 9,004；resume 的 initialCheckpoint 精确等于 cold-start 的最终检查点，包含 `queryImageId=2504`、`candidateAfter=4449` 的查询内后缀。没有把恢复后的累计比较值再次相加。热轮 `reuseBaseId` 精确指向本次新 cold `b02ddcce-cde8-4971-bfd4-689fc98df15e`，不借用旧历史 run。

冷轮原始 SQL 比归因 profile 多 2 条（每段各 1），热轮多 1 条；热 profile 的 BEGIN 为 2,050、COMMIT 为 2,049，不能据此推断具体异步根因或补造缺失事件。所有原始值保留，不改源码或重跑以抹平。热轮耗时反而比本次冷轮长约 6.5%，只证明复用与结果成功，不宣传热轮必然更快。

本次 5k oracle 实际只有两个 candidate 作品对，且两个都发布，正边共 450 条、未匹配比较 19,890 次，没有未发布／null evidence 的作品对实例。它完整核对本次候选与不匹配比较，不等于补做了所有持久负关系场景；密集桶、截断及预算边界由前述专项证据证明。完整任务只有新实现的一次冷／热，旧完整任务未重跑；历史任务耗时属于跨轮参考，不能当严格同条件 A/B。新进程内核接续也不等于本轮重新验证了真实 Worker 调度重启。

### 冻结、构建与退出

九个执行／测试源和五个 DB guard 的当前文件 SHA 与 source-freeze、最终审计逐项一致。主线程在计时开始前完成包含最终测量代码的 executor typecheck、executor 和 Worker 定向 build，日志 exit 0；三条既有 import.meta／CJS warning 保留。独立核对当前 `dist/main.cjs` 摘要为 `e392ae0ce7eb43b42e9df8f5fbbb8a10970082e855c752cbea77a753b4889575`。没有新增浏览器或全量应用通过声明。

最终 runner session 63473 exit 0，本任务残留进程为空，精确规模库的其他会话（包括空闲会话）为空，审计只排除自身连接。carrier 仍是 CANCELLED／VISUAL／PENDING，不代表完成业务检测；cold 为 COMPLETED／DONE／COMPLETE，hot 合成记录仍是 RUNNING／DONE／COMPLETE，因为内核 fixture 不做真实 Worker 的终态收口，不代表进程仍运行。四份保留 100k metadata 按最终投影字段与开工 preflight 逐项比较相等；本次没有重新测量或泛化复审旧 100k。

全部新旧 fixture 和专属测试 CHECK 保留，最终库大小 4,063,941,423 B 是整库大小，非本轮新增写入量或生产存储估算。原件字节和解码次数均为零；READY 特征上的 cold／hot 证明的是本次查询及关系复用，不证明真实图片特征缓存、NAS、并发业务或 App／Worker 端到端吞吐。公开 10,000 原件与原有安全、匹配、删除和预算边界不变。

已快速核对主记录的表格、生命周期和范围措辞，以及 TODO／matching-extension 对本项与后续规模任务的区分，均与原始证据一致。本轮审查结束；最后一次整合文档／diff 检查和提交由主线程完成，审查者不新增检查或提交。
