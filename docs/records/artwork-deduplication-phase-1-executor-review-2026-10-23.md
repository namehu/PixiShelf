---
status: historical
scope: 去重第一阶段 Executor 集成与内容摘要独立代码审查
last-verified: 2026-10-23
sources:
  - packages/pixishelf-job-executors/src/media-content/artwork-fingerprint.ts
  - packages/pixishelf-job-executors/src/media-content/file-reader.ts
  - packages/pixishelf-job-executors/src/scan/media-content-write.ts
  - packages/pixishelf-job-executors/src/scan/media-content-recovery.ts
  - packages/pixishelf-job-executors/src/migration/executor.ts
  - packages/pixishelf-job-executors/src/archive/executor.ts
  - packages/pixishelf-job-executors/src/archive/maintenance-executor.ts
---

# 去重第一阶段 Executor 独立审查

日期：2026-10-23。审查者：独立 GPT-6.1 Sol（xhigh），未参与功能实现。

适用版本：工作树 `/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf`，分支 `codex/artwork-deduplication`，HEAD/base `a4f4a031`；审查对象为阶段 1 尚未提交的修改及新增文件。下列行号对应审查时内容。

结论：**不通过**。4 项 P1 恢复阻塞、1 项 P2 行为回归。仅新增此记录，未修改功能代码。

## 范围与证据

已阅读 AGENTS.md、docs/README.md、第一阶段指纹规格及共享技术契约。审查 media-content、扫描发现/发布守卫与 content-reader、pending-replace、migration、video-processing、archive 内容声明/维护/发布及包导出。DB/runtime/App 只按依赖定向阅读，未重复全面审查。

未重复运行实施者已报告通过的单元 133、PG 12、Executor typecheck 或 foundation/scan/archive PG 全集。四项 P1 基于确定的持久状态转换与调用路径，未执行新的数据库崩溃注入。P2 执行了不访问数据库/媒体的 Node 内存复现。runtime 正在修改的 CANCELLING 到期 PAUSED/ACTION_REQUIRED、控制阻挡和精确授权恢复未重复列为问题。

## P1-01：SKIPPED 迁移的两个事务留下不可恢复声明

主位置：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/src/migration/executor.ts:507`。

[同路径分支](../../packages/pixishelf-job-executors/src/migration/executor.ts) 507–524 行第一次事务调用 publishArtwork(terminalStatus=SKIPPED)；[Prisma 实现](../../packages/pixishelf-job-executors/src/migration/prisma-database.ts) 517–527 行已把 item 持久化为 SKIPPED/FINALIZING。525–527 行的第二个独立事务才 finishContentWrite。

触发：第一次事务提交后退出、取消、租约失效或数据库异常。影响：DIRECTORY/artwork source gate 仍活动，item 已终态。executor 498 行直接跳过 SKIPPED，[恢复读取器](../../packages/pixishelf-job-executors/src/scan/media-content-recovery.ts) 76 行又拒绝 SKIPPED，显式授权也不能接回原 item，扫描与内容读取长期受阻。

最小修复：把上述两个 mutateInTransaction 合并，在同一 fenced transaction 内 publishArtwork 与 finishContentWrite，使 SKIPPED 与 gate 结束原子提交。阶段尚未发布，无需新增正式存量 SKIPPED 兼容；若本地已有复现 fixture，按其测试恢复依据处理，禁止自动清 gate。

缺失测试：publication 后/finish 前注入异常，验证整个事务回滚、item 不进入 SKIPPED且恢复 checkpoint 保留；成功路径验证 SKIPPED 与 gate 终态同时出现。

## P1-02：迁移失败终态保留 gate，却禁止领域恢复

主位置：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/src/migration/executor.ts:100`，另一个出口为 `:762`。

beginContentWrite 在 499–504 行建立 gate 后，[stageMigrationFile](../../packages/pixishelf-job-executors/src/migration/transfer.ts) 可因源文件缺失抛 SOURCE_NOT_FOUND PermanentError。外层 99–108 行直接 closePlan(FAILED) 并继续其他作品，最后可能完成整个 job。普通 I/O 错误到最后 attempt 时，762–769 行也 closeItemAndFiles(FAILED)，没有验证恢复或结束 gate。

影响：ACTIVE 声明留下，原 item 已 FAILED；恢复读取器 76 行拒绝 FAILED，executor 483–496 行继承旧失败后返回，新的 FAILED_FROM_JOB 也不能接管原 job 声明。因此原任务离线恢复无法执行。现有永久失败单测 mock 了 gate，未验证其真实后续恢复。

最小修复：已有 gate 的失败不能沿旧 FAILED/继续完成出口关闭领域。未证明恢复时保留可恢复 checkpoint并进入 ACTION_REQUIRED；只有验证安全收口且在同一 fenced finalizer 结束 gate，才允许终态。只放宽读取器不足以修复，因为执行器仍跳过 FAILED且文件 checkpoint 已关闭。

缺失测试：真实 gate 下分别注入首个 staging 前 SOURCE_NOT_FOUND、部分 copy 后永久错误、最后 attempt 的 EIO/ENOSPC；验证原 job/item 可 inspect/grant/consume，授权后可完成原精确清单，旧 attempt 不能结束新 gate。

## P1-03：CLEAN_STAGING 销毁未完成发布的恢复证明

主位置：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/src/archive/maintenance-executor.ts:449`。

触发：ARCHIVE_PUBLISH 完成 staging → final rename，业务 DML 未提交且仍有 publication gate；job/领域进入允许清理的 PAUSED/FAILED，随后手动或 RECONCILE 发起 CLEAN_STAGING。

[清理执行器](../../packages/pixishelf-job-executors/src/archive/maintenance-executor.ts) 420–439 行无 claim 检查，467–483 行可删 final；543–547 行可取消原 job，549–560 行清 generationToken/sealedManifestSha256并切回 DOWNLOAD。[App 请求入口](../../packages/pixishelf/services/archive/archive-maintenance-service.ts) 254–291 行也无 claim 门禁；Executor RECONCILE 185–227 行可直接排入清理。

影响：原 DIRECTORY/source gate 未结束，但专用 postrename 恢复所需 final/manifest/领域身份已消失。普通 begin 拒绝旧 owner，通用恢复无 ARCHIVE_PUBLISH 分支，声明失去恢复入口；更新既有作品时还会长期阻挡其内容能力。

最小修复：任何删除前在既有发布协调锁下检查原 PUBLISH job/session 未终结 claim，存在则拒绝 cleanup并保留证明，引导先完成原 PUBLISH恢复。手动请求与 RECONCILE 同步阻挡原因，Executor必须保留最终门禁。无需增加清理恢复框架。

缺失测试：真实 gate 构造 rename 后/DML 前失败，分别从手动与 RECONCILE 清理；断言 final、manifest、原 job/session、声明版本和source gate保留，FS无删除，随后原发布恢复可完成。

## P1-04：归档 gate 建立后、rename 前崩溃无恢复入口

主位置：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/src/archive/executor.ts:1329`。

触发：1329–1335 行 begin已持久化，1336 行 prepareArchiveRevisionDirectory 尚未 rename就退出，或 mkdir/rename 抛 EACCES、ENOSPC；final仍不存在。

后续 attempt 的 finalAlreadyPublished=false（1313），跳过唯一 recoverCompletedArchivePublicationWrite（1317–1326），1329 行重新 begin 被旧 owner/attempt阻挡。[恢复领域读取器](../../packages/pixishelf-job-executors/src/scan/media-content-recovery.ts) 无 ARCHIVE_PUBLISH 分支；专用交接要求 FINAL_VERIFIED_STAGING_ABSENT，final缺失无法满足。

影响：普通 retry或原 job原位 RETRY 都无法恢复此窗口；后者仅再次遇到相同 begin冲突。更新归档时原 artwork source gate也一直保留。现有 postrename证明测试不覆盖此窗口。

最小修复：保留 postrename自动交接仅DML；尚未rename且仍需FS工作的原任务，应复用显式停写授权后的精确 job/session/范围CAS恢复入口，不扩大自动证明、不按租约超时接管。同execution捕获的可验证无修改失败可以在原finalizer收口，但不能代替进程崩溃恢复。若复用通用授权，须同步更新当前仅列四领域的契约。

缺失测试：gate durable后、rename前故障屏障；普通retry拒绝接管，显式停写授权后原job下一attempt可继续，范围不扩大；另测rename失败和此窗口取消，不能留无入口声明。

## P2-01：51 个归档版本超过维护声明上限

主位置：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/src/archive/maintenance-executor.ts:741`。

既有publisher保留旧revision，无50版本上限。trash/restore/purge每个revision提交archivePath与trashPath；741–742 行仅剔除清单中已有祖先，普通siblings不归并，51版本产生102个DIRECTORY scopes。[begin helper](../../packages/pixishelf-job-executors/src/scan/media-content-write.ts) 149行拒绝超过100，维护流程误报为已有写声明需要恢复，但未建立gate，授权也无法解决数量问题。

轻量复现：Node内存生成 sources/test/bucket/42/revisions/r0..r50 与 .trash/archive/42/r0..r50，执行同一去重/祖先过滤表达式，结果为 `{"revisions":51,"directoryScopes":102,"rejectedByLimit":true}`。未连接PostgreSQL。

最小修复：按原作品稳定的archive revisions父范围与trash父范围建立少量DIRECTORY scopes，FS仍按原精确revision清单执行；不提高通用上限或扩大删除清单。

缺失测试：51版本的trash、restore、purge，验证scope数量有界、范围归属于原作品、FS清单精确；同时覆盖50版本边界。

## 其他结果与未实测范围

本次静态检查未发现内容多重集合重复项、bigint排序、v1域/长度编码、独立成员签名的新确定阻塞。稳定读取核对同句柄、真实长度、前后高精度属性及最终路径dev/inode并finally关闭；缺失/零字节不能生成新作品结果。warm缓存比较算法/根/路径/revision/epoch/属性且不更新hashedAt；最终作品聚合重新分页读取持久证据。

Local/Pixiv/apply在发现前捕获目录状态，发布在fenced事务内先复核。pending/video/migration未知取消保留gate，已验证恢复通过原finalizer收口。archive postrename先做FS证明，恢复后跳过prepare/rename，只做DML。包导出未发现新增确定阻塞。

未实测：真实ffmpeg/ffprobe、浏览器D1-B01、跨进程kill、FS故障注入、DB/runtime helper完整约束与锁竞争、App lint/test/build、生产迁移及真实媒体。此次无数据库写入、文件迁移、服务启动或Git变更。文档与图示检查由主agent在全部记录合并后统一执行。


## 2026-10-23 修复后窄复审

复审依据：[实施者修复证据](./artwork-deduplication-phase-1-executor-fixes-2026-10-23.md)。复审针对同一工作树未提交的五项修复及必要交界，保留本文首次审查结论，不将实施者报告的 17 个定向用例或 typecheck 计为本审查者独立重跑。

本次结论：**仍不通过**。原四项 P1 的修复闭合了所报告的窗口；原 P2-01 的 50/51 版本行为已修复，但超过 100 个版本时仍会在维护失败后留下无法取得恢复授权的 gate。该剩余路径属于同一问题修复不完整，按下述 P1 阻塞处理，不能仅作为未验证范围保留。

| 原审查项 | 窄复审结果 | 当前代码证据 |
| --- | --- | --- |
| P1-01 SKIPPED 两事务 | 通过 | migration/executor.ts 528–546 行在同一 mutateInTransaction 内 publishArtwork 与 finishContentWrite，成功后才更新内存状态。 |
| P1-02 持 gate 失败终态 | 通过 | 101–105 行将已持 gate 的 PermanentError 转恢复错误；149–166 行覆盖末 attempt；769–789 行将其余未验证写错误保留 checkpoint 并转 ACTION_REQUIRED。FAILED 旧出口只处理没有本次 gate 的情况。 |
| P1-03 清理销毁发布证明 | 通过 | maintenance-executor.ts 207 行 RECONCILE 跳过未解决发布 claim；446、527 行在协调锁内阻挡初次清理与最终清绑定；executor.ts 1338–1348 行 PUBLISH 建立 gate 时在同一协调锁内重查 cleanupRequestedAt，关闭先检查后建声明的窗口。 |
| P1-04 rename 前恢复入口 | 通过 | recovery reader 125–177 行新增 ARCHIVE_PUBLISH 精确领域快照；shared begin 使用传入 now 消费 grant；executor.ts 1354 行传注入 clock，拒绝/未知结果保留原 job 与 import 并暂停。DB resume 在同事务将原 job/import 排队。 |
| P2-01 版本数量 | 部分修复，仍阻塞 | maintenance-executor.ts 752–767 行把规范 revision/trash 路径归并到原作品父目录，50/51 的三动作仍逐原 revision 清单执行；recovery reader 192–199 行仍限制 100 revisions，导致下面的中断恢复缺口。 |

postrename 专用自动交接未退化：media-content-publication.ts 51 行仍先要求完整 final/staging-absent 证明；executor.ts 1357 行仅在未走专用交接时 prepare/rename。pre-rename 经显式 grant，postrename 自动证明后只做 DML，两条恢复路径没有混用。

### 剩余 P1：超过 100 个版本的维护在失败后不可恢复

位置：`/Users/namehu/.codex/worktrees/artwork-deduplication/PixiShelf/packages/pixishelf-job-executors/src/scan/media-content-recovery.ts:192`，拒绝条件在 `:198`。

触发：有效作品有 101 个或更多归档版本；新的父目录归并使维护可以建立两个持久 gate，随后 trash/restore/purge 在任一文件操作、进度提交或最终事务前失败/退出。下一 attempt 的普通 begin 被原 owner gate 阻挡，必须经离线授权恢复；但领域读取器只 take 101，并对 revisions.length > 100 直接抛 STATE_CONFLICT。inspect/grant/resume/consume 均依赖该读取器，因此原 gate 永久没有受支持的恢复入口。旧版本没有产品级 100 revision 上限；这不是仅缺少测试，而是确定的有效数据回归。50/51 成功路径不能证明该范围安全。

实际最小复现：在 Node 内存中用 TypeScript transpileModule 执行当前真实 readExecutorMediaRecoveryDomainSnapshot，仅替换其 Prisma 返回值与 payload parse，不修改源码、不写数据库。相同 ARCHIVE_MAINTENANCE/TRASH_ARCHIVE 原 job/session/作品生命周期，100 rows 返回完整快照，101 rows 抛恢复不可用错误：

```text
{"revisions":100,"domainSnapshot":"READY","snapshotRows":100}
{"revisions":101,"domainSnapshot":"STATE_CONFLICT","message":"Media content recovery domain checkpoint is missing, unsupported or changed"}
```

gate 已可建立而中断后只能走该 reader 的结论，另按 maintenance-executor.ts 615–626 行与 shared begin 的旧 owner 拒绝路径核对。未以真实 PostgreSQL 新增 101 行或执行目录迁移；以上区分了实际运行与控制流证据。

最小有界修复：领域快照不保存完整 revisions 数组，改为按稳定 ID keyset、每页不超过既有 100 条，流式计算**全部** revision 的版本化摘要及精确数量，返回常数大小的 count/digest。摘要绑定现有 id、archivePath、trashPath、trashedAt、purgeAfter 等全部恢复字段，使用确定编码；inspect/confirm/consume 在既有锁和 CAS 约束下核对同一完整摘要。保留共享声明数量上限与父目录 scope；不得仅提高 100、截断前 100 项、跳过后续项或在已开始 FS 工作后才拒绝。

缺失验证：101 个版本的 trash、restore、purge 分别在建立 gate 后中断，原 job 能取得并消费一次 grant，完成原精确清单，旧 owner 不能终结新声明；第 101 项路径/日期变化须使已取得的恢复快照过期。摘要分页需要覆盖边界和全量计数，邻近作品哨兵继续保留。

### 必要交界与验证边界

新 PUBLISH begin 延续现有 context fence（resource/job）→ archive publication advisory 的顺序。另一 DB/control 审查者已独立确认 App 控制路径相反顺序的 PostgreSQL 40P01，并报告主 agent；本次已提供 begin 的对应位置供统一修复，不在此重复计为新的 Executor finding，也未自行更改锁顺序。

本次只执行上述真实 reader 的 100/101 内存复现；读取并核对实施者新增的 PG/真实文件系统测试断言，未重跑其 17 用例、typecheck、全量测试或 docs/diagrams 检查。尚无本审查者的真实 PG/跨进程故障重跑证据。


## 2026-10-23 最终窄复审：超过 100 revisions 恢复

本轮只复审上节剩余阻塞：[恢复读取器](../../packages/pixishelf-job-executors/src/scan/media-content-recovery.ts) 的分页摘要、对应新增单元/PG 测试，以及[更新后的实施证据](./artwork-deduplication-phase-1-executor-fixes-2026-10-23.md)。前四项 P1 已通过的历史结论保持。

**最终结论：Executor 本审查范围内五项 finding 均已闭合，可以通过本范围独立审查。** 本结论不替代主 agent 的跨域汇总、浏览器验收或其他 reviewer 的结论。

代码核对：media-content-recovery.ts 198–221 行取消 revision 总数硬上限，使用 id 升序 keyset，每页 take 100；每条完整记录的规范 JSON 按 UTF-8 字节长度前缀加入带版本域的 SHA-256，绑定 id、archivePath、trashPath、trashedAt、purgeAfter。分页仅保留当前页、游标、hash 状态和 bigint count，返回 version/count/sha256，不累计完整数组、不截断后续记录。精确 count 以十进制字符串进入外层 domain 摘要；现有 inspect/grant/resume/consume 均调用同一读取器，所以完整快照比较也覆盖第 101 项及之后。未改动 schema、DB 写协议或维护 FS 清单。

实际独立复现：沿用上轮方法，在 Node 内存中执行当前真实读取器，只替换 Prisma 返回值和 payload parse；mock 按真实 keyset 参数分页。100、101、200 均 READY，末项 trashPath 变化均改变摘要：

```text
{"revisions":100,"domainSnapshot":"READY","count":"100","pages":[100,0],"lastRowChangeDetected":true,"snapshotBytes":103}
{"revisions":101,"domainSnapshot":"READY","count":"101","pages":[100,1],"lastRowChangeDetected":true,"snapshotBytes":103}
{"revisions":200,"domainSnapshot":"READY","count":"200","pages":[100,100,0],"lastRowChangeDetected":true,"snapshotBytes":103}
```

原“101 项直接 STATE_CONFLICT”的复现已不成立；所有页均进入摘要，分页大小不超过 100，返回体对这三个规模均为 103 字节。

测试证据核对：新增单元测试覆盖 100/101/200、游标、take/无 offset、末项变化与追加项。新增 maintenance PG 测试分别在 101 个真实版本完成文件工作、最终事务前失败后，沿原 job inspect → grant → resume → consume 完成 trash/restore/purge；断言两个 scopes、原 token/source epoch、单次消费、旧 owner 拒绝、全部文件结果及邻近哨兵。漂移测试分别改变第 101 项 archivePath、purgeAfter、trashPath，覆盖 confirm、resume、consume 拒绝，并保留 gate/source/grant 与原文件。上述 PG/单元通过和最后 Executor typecheck 通过来自实施者记录，本审查者核对了代码与断言，未独立重跑这些测试。

本轮未新增或修改功能代码，没有数据库写入、实际文件迁移或服务启动；未重跑测试全集、docs 或 diagrams 检查。仍保留此前记录中的真实跨进程 kill、生产环境、浏览器和超大规模压力测试等未实测边界。
