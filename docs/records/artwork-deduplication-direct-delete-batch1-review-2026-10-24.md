---
status: historical
scope: 直接删除第一批设计及必要写保护的独立有界审查；未开放新删除
last-verified: 2026-10-24
sources:
  - docs/records/artwork-deduplication-direct-delete-batch1-2026-10-24.md
  - docs/records/artwork-deduplication-direct-delete-plan-2026-10-24.md
  - docs/design/artwork-deduplication/direct-delete.md
---

# 第一批必要写保护独立审查

日期：2026-10-24，Asia/Shanghai。审查者：独立 GPT-6.1 Sol / xhigh，非本批实现者；本轮没有其他审查子任务。适用工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`、分支 `codex/artwork-deduplication`、HEAD `6e8d4f4c` 加冻结 WIP。依据[第一批实施记录](./artwork-deduplication-direct-delete-batch1-2026-10-24.md)全部章节，分别核对复杂原语、Sol 普通收尾及最后 CLEAN_STAGING 七文件差异；没有将整个 HEAD diff 算成本批新增。

当前最终结论：**B1 设计及必要写保护达到本批独立审查门槛，无剩余 B1 阻断。** R1–R4 代码发现已关闭，E1–E7 新增证据已由原独立审查者复核通过，详见末节。初审时的 2 项 P1、2 项 P2 及后续暂未通过结论保留为各轮当时证据，已由本节最终结论替代。未修改生产代码、测试、迁移、native 文件或暂存区，没有提交，也没有进入 B2。新 DIRECT_DELETE 不在当前严格模式枚举中，release stage 仍为 3；本记录不证明新删除可用。

## 可行动发现

### R1 · P1：终态清理后的再次请求/协调会使原恢复证据失效

位置：[maintenance-executor.ts](../../packages/pixishelf-job-executors/src/archive/maintenance-executor.ts) 第 235–249 行；同一路径的 App 入口 [archive-maintenance-service.ts](../../packages/pixishelf/services/archive/archive-maintenance-service.ts) 第 300–322 行。

触发：CLEAN_STAGING 已提交目录声明及唯一 checkpoint，文件删除或最终事务失败后由运行时进入 FAILED/CANCELLED，原 ACTIVE 声明仍在。随后正常 RECONCILE 或再次请求清理。两个入口只查原 Import job / `archive-publish:<importId>` 的未解决声明；active maintenance 查询均排除 FAILED/CANCELLED。因此旧清理 job 不被识别，入口推进 `cleanupRequestedAt` 并创建新清理 job。

影响：新 checkpoint 将 `cleanupRequestedAt` 纳入摘要（[staging-cleanup-recovery.ts](../../packages/pixishelf-job-executors/src/archive/staging-cleanup-recovery.ts) 第 63、201–207 行）。旧任务的 inspect/grant/resume 永久拒绝当前意图；新任务又被旧目录声明阻塞。即使文件已全部删除，也不能沿所承诺的原范围恢复协议完成数据库回执。保留 token 本身不足以保留恢复能力。

最小修复：在推进清理意图前，按该 Import 的 CLEAN_STAGING job 及 `archive-cleanup:<jobId>` 检查所有未终结声明，与 job 是否终态无关。有原声明时保留原 `cleanupRequestedAt`、checkpoint 和 job，返回明确恢复要求或复用原恢复入口；RECONCILE 应跳过该项。不能清 token、重签 checkpoint 或创建新 job 来接管。增加真实终态故障→RECONCILE/App 再请求→原 intent 未变→原 offline grant/resume/consume 成功的定向测试。

证据性质：静态确定。已有恢复专项只把故障任务显式置为 PAUSED（[staging-cleanup-recovery.postgres.test.ts](../../packages/pixishelf-job-executors/src/archive/__tests__/staging-cleanup-recovery.postgres.test.ts) 第 290–293 行），不会进入这两个终态分支；不能用其 13 项通过关闭本发现。

### R2 · P1：归档交接及新下载入队仍反向取得隐含 catalog 锁

主要位置：[phase-handoff.ts](../../packages/pixishelf-job-executors/src/archive/phase-handoff.ts) 第 19、32、44 行。相同问题还在 [intake-enqueue.ts](../../packages/pixishelf-job-executors/src/archive/intake-enqueue.ts) 第 39–40、147 行及其 `lockIntakeSource` 第 371 行；自动入队的外层 [resolver-executor.ts](../../packages/pixishelf-job-executors/src/archive/resolver-executor.ts) 第 177–189 行。

触发：DOWNLOAD→PUBLISH（或 LEGACY→DOWNLOAD）在原 finalizer 中先取得 archive publication advisory 锁，再锁原来源，最后创建后继 SystemJob。`system_jobs` 的 `artist_job_enqueue_lock` 是 BEFORE INSERT statement trigger，会取得 creator catalog（[artist_merge migration](../../packages/pixishelf-db/prisma/migrations/20260921120000_artist_merge/migration.sql) 第 24–38 行）。手工 Intake enqueue 及 RESOLVE 自动入队也先取得 archive/source，随后 INSERT job；它们的当前调用链没有预先取得 catalog。

影响：交接/入队事务持 archive/source 等 catalog，普通维护或发布事务持 catalog 等 archive，形成 AB/BA。新维护的 `lockArchivePublication` 已明确 catalog→archive（maintenance-executor.ts 第 860–862 行），`lockArchiveSourcePublication` 同序。因此常规并发即可导致死锁回滚和阶段交接/入队失败；只检查 Artwork/Artist 显式更新会漏掉 job INSERT 的同一隐含锁。

最小修复：沿用既有 catalog，在原 fence/控制事务中、首次 archive/source 锁之前取得。handoff、手工 enqueue 与 RESOLVE 自动分类/入队都要接到外层正确位置；仅在 `systemJob.create` 前或 enqueue 内层补锁会保留倒序。控制/失败回执仍不应附加 OPEN 要求。增加实际交接和入队入口的双事务屏障，证明首次 catalog 获取时尚未持有 archive/source 锁。

证据性质：静态确定，属于本批接续的未过审归档 WIP；不重审已关闭的 App 新意图证明。已有 25 项归档专项验证原 proof 和顺序业务行为，没有这三个入口的并发 catalog 屏障。

### R3 · P2：drain 聚合遗漏同来源 Import 的 CLEAN_STAGING 执行及声明

位置：[artwork-dedup-archive-drain.ts](../../packages/pixishelf-db/src/artwork-dedup-archive-drain.ts) 第 24–38、55–64 行。

触发：同一 PROVIDER 的所有 DOWNLOAD/PUBLISH 已终态、所有 generation 已 drained，但一个清理该 Import 的 CLEAN_STAGING job 正在运行，或失败后留下 ACTIVE/RECOVERY_REQUIRED 目录声明。聚合的 `jobs` 仅来自 Import 当前 job/ArchiveImportExecution，另只匹配 `archive-publish:<importId>`；CLEAN_STAGING 的 job 既不是前两者，其 session 又是 `archive-cleanup:<maintenanceJobId>`，且声明不绑定 Artwork（maintenance-executor.ts 第 559–561 行）。

影响：该真实在途清理不会出现在 stopJobIds/activeWriteIds，函数仍可返回 `drained: true`。当清理范围是同来源的未发布暂存目录、与冻结登记原件不重叠时，现有精确路径 Claim 冲突不能替代这个遗漏。HOLD 阻止它最终提交，也不能证明其先前文件 I/O 已退出。该内部原语尚未接入 B2，当前没有开放删除，但其“已排空”结果不满足 B1 的聚合前提。

最小修复：按已选 Import ID 查询现有 CLEAN_STAGING 任务绑定，把相关活动 job 和其未终结目录声明加入现有结果；失败/取消的 job 也不能让未解决声明消失。沿用 payload/session/job 绑定即可，不需要新通用恢复系统。新增“下载都已 drain + 独立清理 job/声明仍在”的聚合负例，退出且原声明真正完成后再允许 drained。

证据性质：静态确定；现有 drain PG 只有 Import execution/token 维度，没有该新增维护声明的样本。发送控制、等待让槽及最终 fence/version 仍属于 B2 接入，不属于本发现要求本批实现的内容。

### R4 · P2：已有直接受影响的真实竞争测试仍要求清理未排空的代

位置：[download-lane-recovery.postgres.test.ts](../../packages/pixishelf-job-executors/src/archive/__tests__/download-lane-recovery.postgres.test.ts) 第 156–202 行，尤其 191 行。

该测试保持旧 generation 的真实 manifest I/O 阻塞、`drainedAt=null`，却直接 await 清理成功，并要求 successor.cleanedAt 非空。当前 `stagingCleanupIntentDigest` 对任一 generation 缺 drainedAt 立即抛 STATE_CONFLICT（staging-cleanup-recovery.ts 第 97–98 行），executeStagingCleanup 也新增整体拒绝规则（maintenance-executor.ts 第 490–491 行）。因此测试的预期与本批保守门槛直接矛盾；它并没有被前述名称筛选包含。不能把该文件其他所选用例通过说成此项通过。

最小修复：保留真实晚执行屏障，改为断言整个清理在首个文件/声明动作前拒绝，两个 generation 及文件均保持；实际晚执行退出但旧 fence 不能给出回执时，继续要求原退出恢复证据，不能伪造 drainedAt。若要验证后续成功，用真实可提交原 token 回执的独立样本。仅运行这一受影响用例及必要相邻用例即可。

证据性质：静态确定的测试/实现契约冲突；本轮未执行该测试，未把预测写成实测失败。它不是放宽生产 drain 门槛的理由。

## 本轮核对及可沿用的证据

本轮默认静态审查，没有连接数据库、运行功能测试、启动浏览器/App/Worker、读取真实媒体或操作用户服务。已有专项/typecheck 结果只按实施记录中的精确范围引用，未复述成独立重跑结果。没有重跑 50 万规模或全量 build/test。

| 范围                        | 本轮核对结果与限制                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scan 最终事务               | Worker Pixiv/Local/Audit Apply/Local rescan 的 catalog 已位于首次根守卫前；已登记的真实 PG 屏障确实在实际事务首次 catalog 获取处让另一连接取得同根，且断言屏障触达。Local rescan 的专门屏障仍缺，不能扩称已测。                                                                                                                                       |
| App 必要写入口              | 媒体 begin/publication、普通删除、评分及 User 级联、metadata、artist/tag/creator、series、source-sync、migration 的本批接点已读；静态未发现这些已补点另有可行动绕过。集合守卫按受影响 Artwork 升序；类型与已有真实零写负例沿用。                                                                                                                      |
| 来源 release                | 根协调→数据库 identityKey 顺序→owner/generation CAS；双向 PATH/DIRECTORY 重叠均推进代次，保留其他 owner 的状态。内部原语不负责生命周期/fence/真实退出，未来调用者须先验证；不据此开放 allowReimport。                                                                                                                                                 |
| 归档原 proof 与回执         | 原 Import/Intake proof 不因 retry 重新 capture；App 已知 STATE_CONFLICT 映射保留，未知异常重抛；HOLD 下正常 drain/控制回执不新增 OPEN 前提。锁序和聚合缺口分别见 R2/R3。                                                                                                                                                                              |
| 普通 URL hold               | App 请求、实际 begin、最终 publication 及 reconcile 物化前均有相应 hold 接点；已登记早/晚 hold 测试验证失败声明保留。未把直接插入 hold/Claim 的测试称为实际认领并发。                                                                                                                                                                                 |
| CLEAN_STAGING 域 checkpoint | 声明与事件同事务提交；事件缺失/重复不补造；摘要覆盖完整 generation/item 分页、原清理时间戳/来源代次；原 writeId/token/directoryId 不替换。恢复沿既有 inspect/grant/resume/consume。原目录/缺失路径身份在 grant/resume/consume/文件动作/最终事务复核；第 101 个 item 漂移的负例真正跨页。R1 是其外部入口破坏原意图的问题，不否定已验证的局部故障续行。 |
| 拒绝点与测试断言            | 已阅新增恢复、source-release/drain、scan 竞争及 App/shared guard 专项。恢复故障先注入再检查原 claims/DB 状态，负例核对明确 code；未发现靠任意异常吞掉实现错误的通过路径。R4 为未同步的相邻旧测试；其余未触达入口不能用测试数量代替证据。                                                                                                              |
| 设计与门禁                  | 总计划、direct-delete、第一批/方案记录已分清三批、四来源、直接删除及无隔离恢复目标；当前严格 payload 不接受 DIRECT_DELETE，旧高阶段写模式被 stage 3 拒绝。没有把未来 fresh 全组校验、unlink、取消安全边界或墓碑终结当成已实施。                                                                                                                       |

本轮执行 `rg --files packages/pixishelf | rg '[A-Z]'`：无匹配（退出 1）。本轮 `pnpm docs:check` 通过（252 份 Markdown 的本地链接、锚点、路径大小写及围栏），`git diff --check` 通过；review record 已单文件 Prettier 格式化。没有重跑图源生成/渲染，全批 docs/diagrams 最终门禁仍由统筹执行，不能由本记录替代。

## 未覆盖项与批次归属

原独立审查当时列出的 **B1 七项最小证据**现由实施者按明确授权补齐，详见[同批补证记录](./artwork-deduplication-direct-delete-batch1-2026-10-24.md#solb1-独立审查剩余证据补齐2026-10-24实施证据交原审查者复核)。该节最初由实施者登记；现原独立审查者已仅复核两份新增测试及对应表，以下七项均通过，详见末节。没有复跑 R1–R4 或扩大新需求。

| 证据                                      | 实际入口与边界                                                                                                                                                                                                                                                         | 实施验证状态                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| E1：实际 claim 与 maintenance 目录声明    | 实际 TRASH begin 提交后受控停止/FAILED→实际 claim CONTENT_WRITING；实际 claim 提交、writer 轮换→实际 maintenance-owned 目录 begin STATE_CONFLICT。验证同根/目录/HOLD owner，后者是生产目录准入原语，不冒称完整 trash 生命周期。唯一 writer 索引排除同时双完整 writer。 | 新 App PG 两项通过；独立复核通过      |
| E2：实际 claim 与首次章节 begin           | 两个真实事务在 commit 前用显式屏障竞争；两个方向均确切55P03，释放后分别 STALE/WRITING 且零新增 Claim/声明。                                                                                                                                                            | 新 App PG 两项通过；独立复核通过      |
| E3：path-only 真实 Image                  | 实际章节上传以 videoPath 找到登记 Image 并建立原 token 来源声明/READY 回执；之后保持既有 replacement authorization 的409要求，不冒称已成功发布。                                                                                                                       | 新 App PG 一项通过；独立复核通过      |
| E4：Local rescan catalog 屏障             | 实际 executeLocalArtworkRescan 的冻结输入、真实文件发现和最终围栏事务；首次 catalog 前另一连接取得catalog→同根→Artwork，hits=1，真实图片/checkpoint SUCCESS。                                                                                                          | 新 Executor PG 一项通过；独立复核通过 |
| E5：评分/User 级联                        | 实际 App 评分及用户删除入口首次 catalog 前，另一 PG 连接取得同 Artwork/User 锁；真实评分和FK评分级联删除成功。                                                                                                                                                         | 新 App PG 两项通过；独立复核通过      |
| E6：HOLD 下 RECONCILE 零物化              | 同时 source HOLD 的到期 staging 和持久 URL hold 的作品；实际 materializer discovered=2/skipped=2/materialized=0，未 enqueue、未改原行或时间戳。                                                                                                                        | 新 App PG 一项通过；独立复核通过      |
| E7：source-sync/series/migration 最终发布 | 两个真实 Pixiv executor finalizer（合成 response/临时 snapshot）与完整真实 move 迁移；实际首次 catalog 的跨连接屏障，hits=1，并检查真正DB/文件发布结果。系列保留MANUAL成员而返回PARTIAL，有确切protectedFields断言。                                                   | 新 Executor PG 三项通过；独立复核通过 |

新增文件仅 [App 竞争与准入证据](../../packages/pixishelf/services/artwork-service/__tests__/dedup-b1-evidence.postgres.test.ts) 和 [Executor 最终事务证据](../../packages/pixishelf-job-executors/src/scan/__tests__/dedup-b1-publication-evidence.postgres.test.ts)。最终一次分别8/8和4/4，全部是专库/可销毁样本；没有生产代码修改。本节最初为实施者补证登记，最终独立复核结论由末节给出。

以下为 **B2/B3 明确责任，不作为本批代码遗漏**：DIRECT_DELETE 目的/独立 gate、完整认领/真实停止命令/Writer 等待让槽、首删前全组 fresh 重读、精确 unlink 与持久意图/回执、四来源及混合组实际删除、部分失败/取消/重试、业务删除与墓碑/allowReimport；正式 UI、全量最终检查与 Sol/medium 浏览器。旧 native 文件基础的平台阻断仍保持，本轮未触碰或绕过，也未重审已退役移动机制。

本轮完成一次完整有界 B1 review 后停止；后续应只复审上述发现的修复差异及对应新增证据，保留工作树所有 WIP。B1 通过前不自动进入 B2。

## R1–R4 修复差异复审（2026-10-24）

本节由原独立 Sol 审查者在收到统筹明确的新任务后完成；仅复审[实施记录末节](./artwork-deduplication-direct-delete-batch1-2026-10-24.md#astra独立审查-r1r4-定向修复2026-10-24冻结交差异复审)所列 8 个生产文件、6 个专项文件及直接影响，没有第二次全扫 B1。本节覆盖的是修复后冻结 WIP，旧发现的行号及触发描述保留为修复前证据。

**差异复审结论：R1–R4 均关闭，无新增 P1/P2 代码发现。** 本轮未修改实现、测试或其他 WIP，未提交、未启动服务、未运行数据库/功能测试。实施者已登记的 10 项真实 PG 功能证据、三包类型和定向 lint 结果按精确范围沿用，不声称由审查者独立重跑；未借此宣布旧 lint 遗留或未覆盖入口通过。

| 发现                   | 修复后核对                                                                                                                                                                                                                                                                                                                                                                                                                                     | 结论 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| R1：终态原意图被推进   | DB `findUnresolvedArchiveStagingCleanup`（artwork-dedup-archive-drain.ts 第 108–119 行）先严格找绑定原 Import 的 CLEAN_STAGING jobs，再按 job/session 查所有未结束声明，不按任务终态排除。App 在第 310–311 行拒绝新请求，RECONCILE 在 maintenance-executor.ts 第 236 行 SKIP，均先于 cleanupRequestedAt 推进。实际 FAILED/CANCELLED 专项核对唯一原清理 job、时间戳、inspect 摘要、原 writeId/token，并由原 inspect/grant/resume/consume 完成。 | 关闭 |
| R2：catalog 隐含锁倒序 | phase-handoff.ts 第 20 行、intake-enqueue.ts 第 39 行及 resolver-executor.ts 第 177 行均在首次 archive/source 锁前取得既有 catalog。控制分支仍先处理 pause/cancel，没有新增 OPEN 前提。五个真实入口的 probe 在实际首次 catalog 调用前用另一 PG 事务依次取得 catalog→archive→原 provider 行；`hits()==1` 与后续业务成功断言防止未触达或错误被吞。AUTO/manual 竞争保留一个下载任务及获胜质量断言。                                               | 关闭 |
| R3：漏算清理 drain     | 聚合纳入严格 `ARCHIVE_MAINTENANCE + CLEAN_STAGING + archiveImportId` 绑定的 jobs 及 job/session 声明。RUNNING 尚无声明也阻断，FAILED/CANCELLED 的原声明仍阻断，session-only RECOVERY_REQUIRED 也被发现。新负例还证明声明 COMPLETED 后解除阻断，不同 Import 与 RECONCILE 被排除；去重自身任务由 job type 排除，未新增自我阻塞路径。                                                                                                             | 关闭 |
| R4：晚执行测试契约矛盾 | 原真实 manifest 屏障保留；首次清理明确断言 STATE_CONFLICT、零目录声明、旧代和已 drained 后继均未 cleaned、两边媒体仍在。释放真实晚 I/O 后，旧 fence 不能补退出回执；再次清理仍明确拒绝。没有清 token、直接改 drainedAt 或删除竞争用例。                                                                                                                                                                                                        | 关闭 |

CANCELLED 恢复的直接影响已单独核对：[media-content-recovery.ts](../../packages/pixishelf-db/src/media-content-recovery.ts) 仅对真实 job 为 CANCELLED、类型 ARCHIVE_MAINTENANCE、payload 为 CLEAN_STAGING 的路径放行取消标记；snapshot parser 进一步要求原 `archive-cleanup:<jobId>` session。原域 reader 仍严格解析真实 payload，检查唯一原 checkpoint、原声明/意图及精确目录身份。inspect/grant/resume 继续要求全部 writer 停止、无有效租约、原摘要/attempt；只有授权后的既有 resume CAS 清除取消标记。新增测试先把同一 CANCELLED job 改为 RECONCILE，断言 WRITING，再恢复原 payload 并保留 cancelRequestedAt 证明原清理可恢复。没有把“取消”推广为普通媒体任务的恢复授权。

测试质量核对：App 的“删除后失败”注入只在实际清理走到最终事务入口后抛出指定错误，再通过真实 runtime finalizer 形成 FAILED/CANCELLED；RECONCILE 的 enqueueChild 既禁止调用，也核对其未调用、原意图/原声明快照未变。catalog probe 的 PG 锁超时不会被当成业务拒绝通过，触达计数和最终业务状态均必须满足。drain 事务最终只接受精确的合成回滚错误，前面断言失败不会被吞为通过。R4 释放屏障后的通用 reject 仅断言旧失租执行失败；清理拒绝本身仍检查确切 STATE_CONFLICT 和零声明。

**B1 门槛状态：代码发现已闭合，整批验收仍未获得无保留通过。** 初审“未覆盖项”及实施记录仍明确欠缺的 B1 并发/入口证据未在本轮补做，尤其实际 claim 与目录声明/章节 begin 的双向竞争、path-only 真实 Image、Local rescan/评分/User 级联屏障及 hold 下 RECONCILE 不物化。这些是既有证据限制，不是本轮新增代码发现；后续是否补证或收窄验收声明由统筹按已批准 B1 门槛处理。本轮依指令在完成四项差异复审后停止，不自行开启新补测/修复循环。

DIRECT_DELETE 仍未开放。B2 的停止/等待让槽、首删前全组校验、精确 unlink/回执、墓碑与完整取消故障流程，以及 B3 正式 UI/最终浏览器，仍按原三批分工承担，不把其未实施算作本轮缺陷。native 平台阻断及历史无 checkpoint 的保守拒绝保持。

## E1–E7 新增证据独立复核与 B1 最终结论（2026-10-24）

收到统筹明确补证复核任务后，本轮仅阅读[七项补证对应表](./artwork-deduplication-direct-delete-batch1-2026-10-24.md#solb1-独立审查剩余证据补齐2026-10-24实施证据交原审查者复核)及两份新增 PG 文件，没有重新扫描生产代码、复跑已通过套件或增加新验收要求。实现者登记 App 8/8、Executor 4/4、两包类型及新增文件 lint/diff/path 通过；本审查者沿用这些精确执行结果，不声称独立重跑功能测试。

**最终结论：B1 的设计及必要写保护独立审查通过，无剩余 B1 代码或证据阻断。** R1–R4 保持关闭；此前“仍欠七项证据”的条件已由本轮具体核对关闭，不能继续引用上一轮中间结论描述当前状态。本结论限批准的第一批范围，不表示 DIRECT_DELETE、实际不可恢复删除或 B3 最终交付已完成。

| 证据                             | 原独立审查者核对的实际路径、拒绝点与成功结果                                                                                                                                                                                                                                                                                                                                                                                                            | 最终结论 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| E1：maintenance ↔ 实际 claim    | App 文件第 411–480 行通过真实 queue owner 执行 TRASH begin，受控错误仅在声明事务提交后触发；核对 ACTIVE、同根/目录 ID、原 session，再由 runtime finalizer 形成 FAILED，轮换 writer 后实际 claim 明确 CONTENT_WRITING 且零 Claim。第 482–516 行先实际提交双方 Claim/HOLD，原 writer 离开后由真实 maintenance queue owner 调用生产目录 begin，明确 STATE_CONFLICT、零新声明且原两 Claim 保留。反向路径准确标为目录准入原语，没有声称完整 trash 生命周期。 | 通过     |
| E2：首次章节 begin ↔ 实际 claim | App 文件第 300–353 行在真实事务 commit 前用 promise 屏障暂停；另一数据库事务确切 55P03。释放后分别检查关联 Image 的原 writeToken、claim STALE/零 Claim，以及章节 WRITING/零目录声明/零 Image token；没有把等待超时或任意异常当作最终业务拒绝。                                                                                                                                                                                                          | 通过     |
| E3：path-only Image 声明         | App 文件第 355–389 行实际调用 uploadMediaChapterManifest，videoPath 对应真实登记 mp4 Image。明确检查既有 409/Replacement authorization required，同时确认该 Image 的来源 token 和 READY 上传回执、chaptersPath 仍空，证明到达来源声明且未虚报发布成功。                                                                                                                                                                                                 | 通过     |
| E4：Local rescan                 | Executor 文件第 182–253 行使用真实冻结 input/fingerprint/source proof 与临时文件，执行 executeLocalArtworkRescan；首次 catalog probe 的另一连接取得 catalog→同根→Artwork，并要求 hits=1。随后检查新 Image、SUCCESS/UPDATE checkpoint，并由真实围栏事务完成任务。                                                                                                                                                                                        | 通过     |
| E5：评分/User 级联               | App 文件第 391–409 行调用实际 setArtworkRating/deleteUser；另一连接在首次 catalog 前取得同 Artwork/User 的实际 PG 锁，hits=1。评分 level=3 真实落地，带评分用户的 FK 级联删除真实完成且 Artwork 保留，未停在只读或 no-op 分支。                                                                                                                                                                                                                         | 通过     |
| E6：HOLD reconcile               | App 文件第 518–649 行确认两个有意候选以外无无关可物化项；真实 RECONCILE 的结果必须 discovered=2/skipped=2/materialized=0/reused=0，enqueue 未调用、任务数不增、原 Import/Artwork 全行含时间戳不变。分别涵盖 source HOLD 与无活 Claim 的持久 URL hold。                                                                                                                                                                                                  | 通过     |
| E7：source/series/migration      | Executor 文件第 255–358 行运行实际 Pixiv source-sync/series executor finalizer，合成 response 仅替代网络，PG publication 仍真实；首次 catalog 前另一连接锁两个共享成员、Series 和原 ref，hits=1，随后 title/metadata 实际写入且 job COMPLETED，MANUAL 成员/PARTIAL/protectedFields 语义有准确断言。第 360–425 行实际运行 move 迁移及最终 Prisma publication，要求 hits=1、目标路径/内容正确、源 ENOENT、item/job/全部原声明 COMPLETED。                 | 通过     |

maintenance 两方向的覆盖与正式唯一 writer 约束相符：同 lane 两个完整 RUNNING/PAUSING/CANCELLING 被数据库约束排除，不能要求构造一个生产中不允许的“双完整 writer 同时运行”来证明准入。这里先验证已提交声明跨真实 writer 轮换阻止认领，再验证已提交认领跨轮换阻止生产目录准入；两者覆盖合法的两种顺序。章节 App 不占该 Worker lane，其两项确为两个连接对未提交事务的竞争。测试对冻结证据使用合成 fixture 是范围内的安排，不作为重新执行检测或 fresh 文件校验的证据。

两份新文件的 probe 都在真实首次 catalog 调用处暂停，并由独立事务取得实际 PG catalog/行锁；lock_timeout 失败会使测试失败，hits=1 和后续业务写入结果共同防止未触达或 no-op 假通过。拒绝测试检查明确 code/status 与零写结果；受控 maintenance 注入使用同一个 Error 对象断言，未把其他异常吞为通过。测试连接还限定 `127.0.0.1:55432/dedup_executor_next`，文件仅自建临时根。

没有新增生产变更需复审。已知旧 lint 规则、历史无 checkpoint 的保守拒绝及非 native 文件能力限制继续如实记录，未借本轮解除；它们没有形成此批准 B1 范围内尚未关闭的新阻断。B2 的 DIRECT_DELETE/认领后停止与让槽/全组 fresh 校验/精确 unlink/故障续行和 B3 的正式 UI/全量最终检查/Sol medium 浏览器仍留在对应批次。新删除门禁保持关闭，自动化80不恢复。

本轮只更新本 review record；文档收尾检查见本次命令结果。完成新增证据复核后停止，不进入 B2、不继续自主扩大审查。
