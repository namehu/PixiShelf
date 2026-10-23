---
status: historical
scope: 去重第二阶段 Executor、reader、Worker 注册及测量脚本的独立代码审查
last-verified: 2026-10-23
sources:
  - packages/pixishelf-job-executors/src/artwork-dedup/executor.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/pipeline.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/reader.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/reader-child.ts
  - packages/pixishelf-job-executors/src/artwork-dedup/reader-owner.ts
  - packages/pixishelf-worker/src/create-worker-executor-registry.ts
  - docs/design/artwork-deduplication/phase-2-contracts.md
---

# 第二阶段 Executor 与 reader 独立审查

结论：**不通过；确认一项 P2 正确性缺陷，修复并定向复审后再通过本范围门槛。** 审查者为独立 GPT-6.1 Sol（xhigh），未参与第二阶段实现；本次只新增此报告与临时复现，未修改实现、正式测试或提交。浏览器按用户要求留最终统一验收。

## 版本、范围与证据

日期：2026-10-23。工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，基线及审查时 HEAD 为 `9c0f23bcbcda1373d7a6f9b9e6e8d564309ca4aa`；对象为相对该基线的阶段 2 未提交修改及新文件。行号对应首次审查快照，后续修复可能变化。

已阅读 AGENTS、文档入口、[总计划](../design/artwork-deduplication.md)、[后台检测规格](../design/artwork-deduplication/02-detection.md)、[实施契约](../design/artwork-deduplication/phase-2-contracts.md)、[执行器验证记录](./artwork-deduplication-phase-2-executor-2026-10-23.md)，并核对阶段 1 与数据侧审查记录以避免重复 findings。

审查包含 `artwork-dedup/**` 的执行、流水线、reader/protocol/owner/limits 与对应测试；`media-content` 的阶段 2 聚合抽取与根错误分类改动、导出；Worker 注册、capability inventory、构建入口和真实 CJS reader 测试。DB helper 只读取必要调用契约。最终 GROUP 校验的并发窗口由数据 reviewer 的 P2-D201 负责，本报告不重复计数；API、控制和离线恢复不在本范围。benchmark 与 50 万媒体资源测量由独立任务负责；主协调随后追加了下节测量脚本的静态窄审，本 reviewer 不执行负载。

实施者登记的 PG 9、reader 12、阶段 1 相关 11、Worker 注册 15、真实 CJS 1 以及类型检查/单包构建证据，均按原记录复用，未计为本 reviewer 独立重跑。仅对下述疑点运行一次临时的独立真实 Executor/reader/PostgreSQL 复现。

## P2-E201：嵌套归档根的子目录映射变更绕过跨 slice 根绑定

级别：**P2，阶段正确性阻塞**。检测可以在配置已指向另一个归档目录时继续读取旧目录并发布重复组。本阶段不执行清理，因此本次未造成媒体写入或损坏。

主位置：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/src/artwork-dedup/executor.ts:144`，绑定比较位于同文件 153–159 行。路径映射为 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/src/artwork-dedup/pipeline.ts:85`–90；HASH 使用保存的 canonicalPath 为同文件 292、310 行。

当 `archiveRoot` 嵌套在 `sourceRoot` 内时，既有 `resolveMediaContentRoots` 会把两者归一到同一 source 根身份，另外返回 `archiveRelativePrefix`。例如 `sourceRoot=/fixture`、`archiveRoot=/fixture/archive-a` 得到 archive 的 logicalRoot/rootIdentity 与 source 相同，但 prefix 为 `archive-a`。该归一化是阶段 1 的既有行为，本 finding 针对阶段 2 新增 run 绑定未覆盖它，而非重审或否定阶段 1。

Executor 首次持久化和续跑比较只保存两根的 logicalRoot/rootIdentity，没有保存该 prefix。跨 slice 或 Worker 重启把 `archiveRoot` 改为 `/fixture/archive-b` 后，这两个字段仍完全相同。已 STAT 的 canonicalPath 保留 `archive-a/...`，HASH 按该旧路径读取；最终 resolveRoots 也只比较 rootIdentity，因此可以完成并发布旧目录的组。retry 保留的根绑定同样没有这一映射证据。

独立最小复现使用实际 Executor、队列租约围栏、真实固定 reader 子进程及指定的隔离 `dedup_executor_tests` 数据库：

1. 同一 source 临时目录内建立 `archive-a` 与 `archive-b`，登记两件 URL_ARCHIVE 作品，各一文件；A 的两文件相同，B 的对应两文件内容不同。
2. 使用 archiveRoot=A 完成两次可靠 stat 后，以注入时钟触发正常文件边界让行，确认状态为 RETRY_WAIT。
3. 以 archiveRoot=B 继续同一 run/job。实际结果为 COMPLETED、1 个重复组；两条持久媒体 canonicalPath 仍为 `archive-a/...`，B 的两个内容并不相同。

```text
beforeStatus: RETRY_WAIT
rootBindings.source == rootBindings.archive: true
configuredArchivePrefixBefore: archive-a
configuredArchivePrefixAfter: archive-b
archiveBContentEqual: false
afterStatus: COMPLETED
groups: 1
persistedMediaPrefix: archive-a
```

最小修复：把归档的有效路径映射（至少 `archiveRelativePrefix`，或等价的版本化映射身份）纳入首次 rootBindings 持久值和每个 slice/retry 的核对；保持 source/archive 共享物理根的现有命名空间，映射变更必须失败并要求重新明确根。对已经存在但缺失该字段的绑定，不能在恢复时静默按新配置补齐授权；先在阶段 2 契约中明确兼容策略。只增加最后一次 rootIdentity 比较或仅依赖单文件目录 gate 不能覆盖本例，因为 HASH 直接使用旧 canonicalPath。

缺失测试：同一 sourceRoot 内 archiveRoot=A→B 的 STAT 续跑、HASH 续跑及 retry；A/B 保留不同内容且旧 A 仍存在。断言 ROOT_CHANGED、零新组且旧绑定未被替换；补充 prefix 相同正常继续，以及嵌套根和分离根切换。现有“更换整个 source 根 inode”的测试不能覆盖该情况。

## 其他审查结果与验证边界

本次其余已读范围未确认新的阻塞：可靠 stat 使用实际大小，大小多重集合在数据库精确排序比较后筛选；HASH 再复核保存属性，缓存比较源版本、媒体 epoch、根/路径、算法与高精度属性，自己的 observe CAS 版本随 checkpoint 推进。媒体页、stat 并发、hash 并发和提交批次分别有 500/4/1/100 上界；游标按最后已提交文件推进，501 案例断言了恢复不重扫前缀。10 秒/256 MiB 在文件边界保存并以 3 秒 cooldown、preserveAttempt 让行。

媒体 stat/open/read/realpath 与根解析位于固定 child；父进程有界在途请求，字节进展有 ACK 上界。30 秒无属性结果或递增字节会终止 reader，取消后停止接收结果；先确认实际 close 才释放持久 token，close 失败保留 BLOCKED 并使 supervisor 持续故障。STARTING 先于 spawn，ACTIVE 及进程身份先于首个媒体读取；自动恢复用相同 machine/boot/PID namespace 下的 PID 缺失或可靠同机 boot 变化证明退出，不以租约到期替代退出证明，identity-only probe 不接受媒体操作。上述为代码及既有测试断言的独立核对，不代表本 reviewer 穷举或重新执行所有故障测试。

唯一独立执行为 `/private/tmp/dedup-phase2-executor-review-sol/review.test.ts`，配置同目录 `vitest.config.mts`；从 Executor 包执行 `vitest run --config /private/tmp/dedup-phase2-executor-review-sol/vitest.config.mts`，**1/1 通过**，表示缺陷断言已复现，不是功能验收通过。仅使用 `127.0.0.1:55432/dedup_executor_tests`、唯一 `review-executor-stage2-<uuid>` fixture 和临时合成文件；finally 删除本次 run/job/作品/艺术家/目录证据与临时媒体。未使用 data/browser/scale 数据库，未访问用户图库或执行真实迁移、隔离、删除。

未重跑测试全集、主应用 lint/test/build、Worker build 或浏览器；生产环境、NAS、50 万媒体以及下载/浏览/发布竞争不由本报告证明。本 reviewer 的文档检查结果见末段；图源未修改，图示检查由主协调统一登记。


## 测量脚本补充窄审

主协调追加范围后，使用 rg 列出 `scripts/artwork-dedup-benchmark.ts`、`scripts/artwork-dedup-contention.ts` 及 `scripts/tsconfig.benchmark.json`，核对[性能记录](./artwork-deduplication-phase-2-performance-2026-10-23.md)。未发现其他 benchmark-only 实现 helper。下述两项只涉及测量 harness 与合成夹具，不应累计为核心检测算法的产品缺陷；两脚本仍由 benchmark 实施者维护，行号对应本次静态读取快照，修复结果需另外核对。

### P2-M201：共享基线的清理守卫晚于删除，未覆盖争用参与者

位置：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/scripts/artwork-dedup-benchmark.ts:118`–136；调用删除根目录位于 395–396 行。共享关系为 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/scripts/artwork-dedup-contention.ts:30`、168–209 行。

contention 复用 phase2-all 根和原 40 件 Artwork 的媒体，以新艺术家/run 冻结它们；其下载与发布也写同一根。scale cleanup 只以自身 `requestedBy`/job 前缀检查 token 和 lease，随后立即删除自身 run/job/Image/Artwork。若争用场景已建立或正在使用这些 Artwork，前置守卫仍通过，而其冻结样本会被删除。后续“该 rootIdentity 已无 MediaContentSource”断言可能阻止根目录删除，但前面的数据库删除已经提交，不能充当前置保护。

最小修复：在任何数据库或文件删除前验证共享 fixture 的参与者、非本 run 的冻结引用、艺术家关系和根占用，并明确共享 fixture 的保留/清理顺序；可由组级 manifest 标记 contention 使用后拒绝普通基线 cleanup。守卫不能仅匹配清理者自己的前缀，也不能在部分删除后才断言。补充有活动 reader/租约、仅建立冻结引用、争用已经完成但保留证据三种清理拒绝，以及真正独占 fixture 的精确清理测试。

本项为静态控制流确认，未运行破坏性清理或规模负载。benchmark 实施者已收到并开始修复；本报告写入时未宣称修复通过。

### P2-M202：发布失败或暂停后可无限轮询，并提前登记完成事件

位置：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/scripts/artwork-dedup-contention.ts:342`–352、357–369。

writer 循环只在两个检测和 import 全部 COMPLETED 时退出；没有终态失败/暂停检查或总耗时、无进展上限。ARCHIVE_PUBLISH 的正常 finalizer 可以收口为 FAILED/PAUSED/RETRY_WAIT 并返回，而不向调用方抛异常；该分支却无条件先写 `publication-finished`。失败或暂停后没有可 claim 工作，脚本会永远每 50 ms 空轮询并持续浏览，不能形成真实的完成/失败测量，最终浏览样本数组也会持续增长。

最小修复：执行发布后读取实际 job/import 状态，仅在实际完成时登记完成事件；不可继续的终态或人工处理状态立即失败并保留现场。外层增加明确的总期限或无进展期限，超限不能自动清 token/gate；下载等在途工作在既有安全边界收口。用 stub finalizer 的失败、暂停、等待重试及持续不可 claim 情况做无负载 harness 检查，不能只验证成功路径。

本项为静态控制流确认，未注入真实发布故障或运行争用负载；已交主协调与 benchmark 实施者处理。

### 测量真实性与限制

两脚本调用真实检测 Executor/reader 与真实队列 fence，scale SQL 事件与 reader hook 的口径与记录一致；冷轮仅表示内容缓存为空。50 万 Image 登记复用少量实际文件，记录已明确其不等价于 50 万独立文件或 NAS 冷盘；本 reviewer 没有把共享路径、热页缓存或 smoke 数字认定为该物理规模通过。contention 使用真实下载/发布执行器和 loopback 合成 provider，HTTP 浏览要求登录成功且响应含合成作品；它是直接执行器 harness，不是生产 Dispatcher/Worker 故障演练。性能结果与最终 App 浏览器交互仍由各自证据证明。

本次文档新增后 `pnpm docs:check` 通过（204 个 Markdown），`git diff --check` 无输出，主应用路径大小写检查无匹配；没有重新构建或重跑功能测试全集。


## P2-E201 修复后窄复审（2026-10-23）

**核心 Executor/reader 范围结论：通过。** 本节覆盖 P2-E201 修复和必要根绑定交界，保留前文首次审查的历史发现；数据 P2-D201 已由原数据 reviewer 单独复审，本轮没有重审。测量脚本结论另列，不用核心修复通过代替性能验收。

核对版本仍为基线 `9c0f23bc` 后的同一未提交工作树；修复范围为 `executor.ts`、邻近 PostgreSQL 用例、阶段 2 根绑定契约及[实施者修复记录](./artwork-deduplication-phase-2-executor-2026-10-23.md#p2-e201-定向修复2026-10-23)。以下行号对应修复后代码。

- Executor 353–370 行把 `version:1`、source/archive logicalRoot/rootIdentity 与 `archiveRelativePrefix` 作为同一完整绑定；空 prefix 同样须显式存在。145–167 行在执行流水线之前保存/复核，227–237 行在 slice 结束和 GROUP 发布前按同一字段集合再次复核。共享物理根的既有命名空间未改变，STAT/HASH/retry 无分支可以跳过映射比较。
- 旧非空格式缺 version/prefix 会比较失败，原值不被替换。148–163 行只允许初始 STAT、计数均为零、所有 Item 为 PENDING 且没有媒体记录的 null 绑定首次写入；已有进度的 null 不能静默接受当前配置。retry 保留既有绑定，因此清空临时 stat 并提高 executionVersion 不能重新授权旧格式或变化映射。旧 run 保留失败记录并另建检测的兼容策略已写入实施契约。
- 新增正式用例覆盖 STAT/HASH、retry、嵌套/分离根双向切换、最终复核时变化、同 prefix 继续、旧嵌套/空 prefix 格式、缺字段和 null 已有进度。拒绝用例检查零组、原绑定保留；开始即拒绝用例检查零 inspect/read。实施者登记的 11/11 及 Executor typecheck 按其记录复用，本 reviewer 读取断言后未重复整组执行。

本 reviewer 只重跑原独立临时复现，仍使用实际 Executor、真实固定 child、现有队列 fence 与专用 `dedup_executor_tests`，同样 A 中相同、B 中不同的两个文件及同一 STAT checkpoint。只把原“错误地完成”断言改为预期拒绝，2026-10-23 23:02 **1/1 通过**：

```text
beforeStatus: RETRY_WAIT
savedBinding.version: 1
savedBinding.archiveRelativePrefix: archive-a
afterStatus: FAILED
errorCode: ROOT_CHANGED
groups: 0
resumedInspections: 0
resumedReads: 0
bindingUnchanged: true
archiveBContentEqual: false
```

原路径下的持久 stat 行保留用于诊断，没有进入新哈希或发布。复现路径仍为 `/private/tmp/dedup-phase2-executor-review-sol/review.test.ts`，fixture 以唯一前缀创建并在 finally 自清理。本次没有访问或写入 `dedup_scale`、功能 data/browser 库或真实媒体；没有修改实现/正式测试，没有重跑全量 tests、Worker build 或浏览器。


## 测量脚本修复后窄复审（2026-10-23）

**测量脚本范围结论：通过；P2-M201、P2-M202 已闭合。** 这是冻结脚本的静态窄复审结论，不是 50 万全候选或争用负载已经完成的结论。benchmark 实施者已确认两脚本及定向 tsconfig 冻结；本 reviewer 未运行脚本、负载或写入 scale 数据库。

M201：`artwork-dedup-benchmark.ts` 120–180 行在第一条删除（182 行）之前检查永久保留 marker、其他 run 的冻结项、其他艺术家归属、同根外部 MediaContentSource、其他 run 根绑定和 write/recovery 证据。`artwork-dedup-contention.ts` 175–186 行在首个 fixture 数据库写入前以 `wx` 创建 `contention-retained.json`；共享现场的保留及清理顺序写入性能记录。补充澄清初审触发范围：原有 `validateDatabase` 已能拒绝部分含其他 runnable job 的活跃情形，仍不能覆盖已完成/暂停场景的持久共享引用；新守卫也覆盖这些非 runnable 引用，因此不会先删 baseline 再发现外部引用。实施者的 marker CLI 检查及前后 500,000 条 Image 保留来自其证据，本 reviewer 没有在 scale 库重复执行。

M202：`artwork-dedup-contention.ts` 355–376 行在空轮询前检查异常终态，并设置十分钟总期限、两分钟无 writer 进展期限；394–403 行先确认发布 job/import 都为 COMPLETED 才发 `publication-finished`，失败经 504–507 行记录 `contention-failed` 并非零退出。原正常 finalizer 失败/暂停后被当作完成、永久空轮询的问题已不成立。期限在安全循环边界检查，不把它描述成强行中断任意系统调用；失败不会清除 reader token、源 gate 或共享 fixture marker。

另外核对本轮必要交界：scale 的 388–427 行在 claim 返回空时重读 `availableAt`、100 ms 重试并以两分钟为界，异常终态立即拒绝，仍只接受原 job ID；诊断消耗真实 cooldown 余量不再被误判为配置失败。343–361 行逐行读取同 run 的既有 slice 日志，不加载媒体全集或整份日志数组；累计实际 reader/SQL 证据，slice 编号与 segment 延续。514–520 行要求聚合 inspect/read/bytes 与最终持久计数相等，缺失的日志不能悄悄变成完整测量。

恢复后的 `sql` 明确仅代表当前 segment，`allSliceSql` 仅合并已持久 slice 中的 SQL 计数，未补造旧 segment 未保留的 claim/统计查询。总 wall、当前 segment、已观测分段时间和最后 slice 到恢复的间隔分开保存。性能记录明确本次 all 冷轮跨脚本中断及审查修复，不能当作固定源码、不中断的单次冷测。

仅只读核对了 `/private/tmp/dedup-scale-root-bindings-upgrade.json`：实施者登记专用合成 run 的显式旧 JSON CAS、真实 reader 相同根证据、只更新一行且前后 stat/media 均为 230,904。该人为 fixture 兼容处理不在产品路径新增旧绑定自动接受规则；产品旧格式拒绝结论保持。本 reviewer 没有重做 CAS，也没有将该记录当作当前 scale 数据库的独立查询证明。

核心 P2-E201 与测量脚本的修复结论分别如上。原阶段 2 资源测量、真实 NAS、生产恢复及最终浏览器门槛继续按各自记录收口，本轮没有新增可以替代它们的负载证据。

本轮追加记录后，`pnpm docs:check` 通过（206 个 Markdown），`git diff --check` 无输出，主应用大小写路径检查无匹配。benchmark 实施者另确认最终定向 `tsc -p scripts/tsconfig.benchmark.json --noEmit` exit 0；此类型检查未由本 reviewer 重复运行。图源未变，Worker build、全量 tests 和浏览器均未重跑。


## HASH 分页与热批快照优化窄复审（基线 6627e60c）

**结论：通过；本次优化未发现 blocker。** 审查基线为 `6627e60ca5a8b18a1ee8e8c9227deb47a8d30ae0`，对象仅为该基线后的未提交 `pipeline.ts`、`media-content-evidence.ts`、相应测试和阶段 2 契约/实施说明。benchmark 的后续 measurement-gap 调整及阶段 3 文档不属于本节，本结论也不延伸到它们。

`pipeline.ts` 265、271 行的两个 HASH 查询都使用 `cacheBatch=100`，仍按同一个 `afterImageId` 升序 keyset 取成员与可靠 stat、逐项核对 imageId/path/sourceRevision，完成批提交后才在 350、363 行推进游标。提前让行仍仅推进实际提交的前缀；STAT 页的 500 上限未变。没有从 500 页剩余部分推导成功数量，也没有改变文件读/缓存选择或检查点围栏。

`media-content-evidence.ts` 171–176 行的新导出只包装既有私有 `assertArtworkSnapshot`，通过原有通配导出可用；没有新增未围栏的数据库入口。HASH 纯热批在 344 行改用它，替换每批重新 capture/count。既有私有校验 73–85 行仍以 `lockContentArtworks` 的 Artwork `FOR UPDATE` 串行化，并核对整作品 writeToken、revision 和 mediaEpoch；锁持有至包含媒体行、Item 游标与计数的同一 fenced mutation 事务提交。

已核对该信任前提的必要交界：正式 Image 增删和 artworkId/path/size 更新触发器均先锁定相关 Artwork 并推进 ArtworkContentSource revision；`beginMediaContentSourceWrite` 在锁定相关 Artwork 后推进 revision，整作品写入还提高 mediaEpoch 并设置 token；`beginMediaContentPathWrite` 通过 `advanceDirectoryContent` 锁定已绑定媒体所属 Artwork、推进目录 generation 和作品 revision。因热文件已经在 STAT 阶段绑定目录，源/目录写入在先会使旧快照拒绝，在后则须等待本批提交后再推进版本。成员数量不可能在遵循这些现有协议的情况下悄悄改变而保持同一 revision。

初始 `captureArtworkContentSnapshot` 的完整成员 count、源及目录 writer 检查保留；`publishCompleteArtworkFingerprint` 的完整成员遍历、`assertCompleteFingerprints` 的有效文件总数与最终 publish 校验保留。observe/publish 的目录与源检查、最终 GROUP 内容及归属锁和租约 fence 均未改动。旧 revision/epoch 或已开始的源/目录写入仍通过私有快照检查拒绝；整作品 gate 仍显式返回 WRITING；旧 lease 在进入保存批事务前仍由原 `mutateInTransaction` fence 拒绝，不因新的热批 helper 绕过。

测试证据核对：新增 DB 8 项覆盖不变快照、成员增删、源/整作品/目录写入、旧 revision/epoch，同时通过真实 query 事件断言新 assert 不执行 COUNT。Executor 新增两件各 501 媒体、100 文件检查点后继续和热轮，断言冷轮 1,002 次内容读、热轮零内容读、两轮各 2,004 次属性检查，覆盖 100/500/501 分页边界；热文件 inspect 后注入增删或源/目录写入，断言受影响 Item 为 CHANGED、零已提交 SHA 行和零组。已有旧 lease 零发布路径仍在本轮实施者选择范围内。上述 DB 8/8、Executor 8/8 与两包 typecheck 通过来自[实施者记录](./artwork-deduplication-phase-2-executor-2026-10-23.md#hash-页预算与热缓存复核窄修复基线-6627e60c)，本 reviewer 核对源码、协议与断言，没有重复运行这些测试或全量测试/构建。

本轮只修改此审查记录，没有改实现、正式测试、迁移或其他协作者的改动；没有数据库写入、负载运行或浏览器操作。

本节交付检查：`pnpm docs:check` 通过（206 个 Markdown），`git diff --check` 无输出，主应用大小写路径扫描无匹配。图源未变，本轮不重复图示、构建或全量测试。


## 有界基准分段与中断计量窄复审（基线 b0174077）

**最终结论：通过；本轮发现的 P2-M203 已在同轮最小修复后闭合，无剩余 blocker。** 审查对象仅为 `b01740774875426a82c8d8e1e2255084624e96bd` 后冻结的 `scripts/artwork-dedup-benchmark.ts` 与[性能记录](./artwork-deduplication-phase-2-performance-2026-10-23.md)增量；不重审核心 Executor 或阶段 3。以下行号对应最终冻结脚本。

### P2-M203：过期恢复保留历史 attempt，与旧的零值断言冲突

初审定位：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/scripts/artwork-dedup-benchmark.ts:603`。本轮新增 RUNNING 过期恢复允许合法进入已消耗 attempt 的同一 run，但原有断言固定要求让行后 `current.attempt===0`。正式队列过期恢复保留历史 attempt，claim 再加一，schedulingYield/preserveAttempt 仅扣回本次 claim 的一次；实施者的真实中断快照也是 attempt 1。因此旧断言会使恢复后的首个成功 slice 在已安全释放后误报失败，到不了 segment-end/exit75。

最小修复已改为 `current.attempt===job.attempt-1`，只比较本次 claim 基准，没有清零、重写数据库 attempt 或放宽队列恢复。独立无数据库验证从最终源码提取实际断言并执行：

```text
priorAttempt=0 -> claimedAttempt=1 -> yieldedAttempt=0: PASS
priorAttempt=1 -> claimedAttempt=2 -> yieldedAttempt=1: PASS
incorrect unchanged claimedAttempt: REJECTED (both cases)
```

这项实际表达式验证只证明脚本断言与队列语义兼容，不替代真实恢复执行；队列 claim/recovery/preserveAttempt 控制流已按 `queue-repository.ts` 492、1091、1544–1577 行核对。本 reviewer 没有向 scale 库发起 claim/recovery、改 attempt 或运行负载。

### 其余增量结论

- 分段：`--max-segment-ms` 默认 0，非负整数校验在数据库连接前；300000 是从进程开始计算的软预算，不中断在途 slice。599–606 行先检查 lease 为 0、reader token 为 null、状态为 RETRY_WAIT 及本次 attempt 已扣回，607–620 行才写 `run-segment-end` 并返回 yielded；主流程随后设 exit75、等待正常数据库断连。恰好完成的冷轮先正常生成结果，预算耗尽则在创建热轮前退出，不把尚未退出的 reader 当作已释放。
- 恢复：489–500 行只在 `--resume` 且 RUNNING 的执行已过期时调用真实 `PostgresQueueRepository.recoverExpiredExecution('BACKGROUND_WRITER')`，未过期执行明确拒绝；核对返回的原 job ID。脚本没有新增 token/gate/lease 清零逻辑。重新 claim 后仍调用真实 Executor，其原有同机/boot/PID 退出证明独立决定能否释放旧 reader 占用；队列回收本身没有替代该证明。
- 缺口：349–438 行将最后已记账累计与当前持久计数的正差写成 `measurement-gap`，单列 `committedWithoutMeasurement`，readerMetrics/SQL 为 null。重放该事件时把 `lastAccountedCommitted` 推进到 `committedAtObservation`；后续 slice 又推进到其实际累计，所以相同缺口不会在重复 resume/inspection 中再次计算。负差拒绝继续，不隐式重置计数。
- 真实性：`aggregate` 仍只累计实际 slice hook，未把 1,217 条、4,984,832 字节的已提交差值填成 inspect/read 遥测、RSS、IPC、延迟或 SQL。最终将“已观测 + 已提交缺口”仅用于与数据库一致性核对，并保持 measurementCoverage.complete=false；产品完成与遥测不完整分开。全轮 wall、分段 wall、已观测时长与中断间隔的既有口径保留，SQL 仅声称当前段或已观测 slice 范围。

本节更新此前“hook 必须完整等于 DB 才输出结果”的测量策略：已知中断会丢失 hook 而保留合法提交，现在输出明确 partial coverage，不把缺失遥测伪装为完整，也不将正确的领域结果误报为失败。该变化只属于 benchmark harness，没有修改产品计数或恢复协议。

只读核对实施者的两次 inspection 日志与前后状态 JSON：第一次记录一个 1,217/4,984,832 缺口，第二次没有重复 gap；两次 observedReader 与 coverage 相同，run/job/token/lease 快照前后一致。负数/缺参拒绝日志及最终定向 tsc exit0 复用实施者证据，本 reviewer 未重复连接 scale 或运行这些 CLI。实际 300 秒分段、真实过期回收后的续跑及后续 50 万结果留给统筹的独立测量记录，不能从本次静态通过推断已完成。

本轮只追加本审查记录，保留首次 findings 和各轮历史结论；未修改实现、正式测试、数据库或其他协作者文件，未运行长负载、构建或全量测试。

本节文档检查：`pnpm docs:check` 通过（206 个 Markdown），`git diff --check` 无输出，主应用大小写路径扫描无匹配；图源未修改。
