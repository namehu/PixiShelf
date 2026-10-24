---
status: draft
scope: 普通归档消费原来源证明、下载代登记及发布恢复的本域接线；不开放去重文件操作
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/claims-contracts.md
  - packages/pixishelf-job-executors/src/archive/executor.ts
  - packages/pixishelf-job-executors/src/archive/resolver-executor.ts
  - packages/pixishelf-job-executors/src/archive/intake-enqueue.ts
  - packages/pixishelf-job-executors/src/archive/media-content-publication.ts
---

# 归档原来源证明接线

> 2026-10-24 状态：生产接线保留为 WIP；部分定向 PG 已通过，但其后参数整理、pure 单测、lint 和独立审查尚未闭合，见[归档暂停交接](../../records/artwork-deduplication-archive-sources-pause-2026-10-24.md)。第一批须收口真实 drain、普通维护 hold 和原证明链，再作为[直接删除](./direct-delete.md)前提。旧隔离/恢复/PURGE 不再实施；普通 URL 删除继续回收，去重专用删除绕过回收。新能力门禁关闭。

本域只消费五槽契约中 Intake 与 Import 已冻结的 PROVIDER 证明，不创建或刷新来源代次。原证明为一个严格 PROVIDER identity/sourceId/generation；解析结果必须与提交时纯 URL 身份相同。旧 null、缺失、未知版本、身份变化、HOLD 或代次变化进入明确拒绝路径。重新领取、重试和已落盘发布恢复都不构成新来源意图。

RESOLVE 在首次网络调用前检查 Intake 原证明；最终解析事务再次核验后才可更新来源身份/成功结果或自动入队。READY、已有 ENQUEUED、活动任务复用和 enqueue race 恢复同样验证 Intake 与被复用 Import 的原证明；新 Import 只复制已校验 Intake 证明。原任务取消、暂停、失败回执不检查 OPEN，不以控制回执重绑定来源。

DOWNLOAD 启动在原 job fence 内检查 Import 证明并登记执行 token 对应的 ArchiveStagingGeneration，之后才发生首次 staging 文件动作。每个新下载/复用复制单元、成功媒体收据、manifest 封印与阶段交接均复核原证明；generationToken 只代表执行身份。新 token 不改变 dedupSourceSnapshot，已 drained/sealed 的执行不能再接受新媒体操作。

正常 drain 只在所有媒体操作 settled、流与 reporter 关闭且本执行文件动作结束后，以原 token/jobId/importId 持久记录；不通过当前 Import 指针替原 token 作证。来源 HOLD/null 不能阻止此回执。租约过期或发送 cancel 仍不能替代退出证明。本批不实现维护侧全来源 drain 聚合、普通URL hold接线或真实直接删除动作。

PUBLISH 的 begin、已落盘恢复重绑和最终事务遵守既有 catalog→root→source→Artwork 顺序。需要维护 creator catalog 的调用先取既有 creator catalog 和归档协调锁，再取既有受信根协调、原 PROVIDER 来源、Artwork/媒体写声明。根协调不由 provider 证明替代；既有封存、drained、manifest、目标 Artwork CAS 与写 token 继续生效。不得在 root/Artwork 锁内才首次反向取得 creator catalog。发布取消仅走原写声明的 verified-rollback 回执，不要求来源仍 OPEN。

验收限合成隔离库：/g与/s身份、RESOLVE前后拒绝、AUTO/MANUAL与reuse/race、首次staging前已登记、下载单元/成功收据拒绝、HOLD后原token drain、phase handoff和已落盘恢复保留原证明。没有真实 release 双向传播或实际维护文件动作证据时，gate维持3。


## 第一批维护入口补充

普通 trash/restore/purge 的请求与实际声明建立、最终提交遵守持久 URL hold，归档协调锁之前先取得 creator catalog；实际文件动作期间依靠已提交内容声明反向阻止新的维护认领。reconcile 对 hold 候选不物化新工作。staging cleanup 同样在首次删除之前登记原执行拥有的精确目录声明，并在原最终事务释放；先校验每个 generation 路径和实际 drainedAt。无 generation 的 LEGACY 终态任务不能再仅凭 FAILED/COMPLETED 在线清理，需独立退出恢复证据。声明或原来源 HOLD 不妨碍原控制/失败/drain 回执。

`inspectArtworkDedupArchiveDrain` 仅提供已认领范围的聚合事实与待停止 job ID。认领后发送原控制命令、持久等待、Writer让槽以及取消/完成的生命周期CAS由第二批接入；本批没有声称跑过直接删除完整流程。最新具体通过范围、仍欠验证和交接以第一批记录为准。

## CLEAN_STAGING 中断后的原范围续行

首次清理在同一原 job fence 事务中提交精确目录声明和唯一 `archive.cleanup.checkpoint` 任务事件，之后才允许删除。事件只绑定本次已有清理意图：Import 身份/阶段/状态/cleanupRequestedAt/原来源证明、全部 generation 与 item 检查点摘要、当时已存在来源行的身份与代次，以及受信根和精确目录的设备/inode/创建时间身份。不生成或刷新 OPEN 来源授权。checkpoint 不能随重试重写；多条、缺失（含事件裁剪）、旧声明无 checkpoint 均保守拒绝，不自动释放声明。

文件操作前失败、删除部分或全部文件后失败、最终 DB 事务回滚均保留原声明与 checkpoint。确认旧执行实际退出并停止全部 writer 后，沿既有 inspect → grant → resume → consume 协议为原 job 下一 attempt 转交原 write token；不得清 token、换新清理任务或扩大目录范围。域快照分页摘要覆盖全部 generation 和 item；在 inspect/grant/resume/consume 及最终提交重新核对原意图和路径身份。原目录仍在或已缺失可续行；原本缺失的目录出现、目录被替换、根/父路径不再可信、generation/路径/item/来源代次变化均拒绝。HOLD/TOMBSTONE 阻止清理发布，不阻止原执行的停止/失败回执；恢复授权本身不解除 HOLD，也不刷新来源证明。

该协议保留既有 root-confined 文件能力的边界，不宣称获得 native 原子路径操作能力；仍不开放去重独立删除。已经运行但未持久保存本域 checkpoint 的旧 WIP 声明需单独人工核对，不凭当前文件缺失推断已安全完成。

## B1 审查修复：终态意图、入队锁与清理 drain

App 再次清理请求和 RECONCILE 在推进 cleanupRequestedAt 之前，必须按 Import 的 CLEAN_STAGING payload/job/session 检查未结束写声明；FAILED/CANCELLED 不能绕过。发现原声明时 App 返回原任务恢复要求，RECONCILE 跳过，原意图与 checkpoint 不变。原 CANCELLED CLEAN_STAGING 仅在既有 offline 全 writer 停止检查、原 checkpoint 校验后可授权下一 attempt；取消标记只在该原恢复事务中清除，不放宽其他取消任务的恢复。

DOWNLOAD/LEGACY 阶段交接、手工 Intake enqueue、RESOLVE 自动分类/入队均在首次 archive/source 锁前取得既有 creator catalog，覆盖 SystemJob INSERT 的隐含触发器。取消/暂停回执仍不附加 OPEN 检查。

drain 聚合除 Import 当前和历史下载/发布，还包括严格 payload 绑定该 Import 的 CLEAN_STAGING 任务及其 job/session 未结束声明，不因 FAILED/CANCELLED 忽略。仅加入 CLEAN_STAGING，不把去重维护自身任务或其声明算为旧归档执行。任一代缺退出证明时整个清理在首次文件/声明前拒绝，不能只清理后继代；旧失租执行实际退出也不能替代原 token 持久回执。
