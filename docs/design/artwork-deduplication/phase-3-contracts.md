---
status: historical
scope: 旧第三至第五阶段实现契约；保留审核和PREPARE细节，隔离恢复清理授权已替代
last-verified: 2026-10-24
sources:
  - docs/design/artwork-deduplication/03-review.md
  - docs/design/artwork-deduplication/ui-design.md
  - packages/pixishelf-job-contracts/src/artwork-dedup.ts
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf/services/media-mark-service.ts
  - packages/pixishelf/services/artwork-service/delete-artwork-files.ts
---

# 旧第三至第五阶段实施契约（部分保留）

> 2026-10-24 替代声明：本文保留当时实现接口以供代码和历史证据对照。**审核、分页、账户隔离、冻结表、PREPARE 检查点及 reader 恢复基础继续复用；ISOLATE/RESTORE/PURGE、ISOLATION/PURGE 目的、隔离目录和第二次清理确认全部被[直接删除契约](./direct-delete.md)替代。** 下文旧阶段 4/5 门禁数值、mode/status、备份表单和调用示例不能授权 DIRECT_DELETE。新目的/协议须重新准备，独立能力门禁默认关闭。当前三批实施顺序及最新模型分工仅见[总计划](../artwork-deduplication.md)，不沿用下文旧并行指令。

本文细化[第三阶段计划](./03-review.md)。按 2026-10-24 用户调整，第三至第五阶段可以并行实施，第二阶段剩余规模测量不阻塞编码；验收及操作开放仍按预览、隔离恢复、永久清理依次完成，浏览器留最终统一验收。本文先固定 PREPARE，再以下节维护扩展固定 ISOLATE/RESTORE/PURGE；不能由各模块自行扩展。输入、DTO、枚举与维护 payload 在 job-contracts 的 Zod 契约单一维护；App、DB helper、Executor 与 UI 不各自定义同名协议。

## 账户、版本与最小持久数据

检测结果和清理计划是实例管理事实；保留选择按 Session 账户保存。所有 API 以 Session 为操作者，expectedUserId 只验证账户未切换。其他账户的整理记录只能投影为 `otherAccountHasOrganization` 布尔值，不返回账户 ID、评分、标记种类/数量、时间或阅读排序依据。内部保护查询覆盖 `ArtworkLike` 与存在 bookmarkedAt/likedAt 的 `MediaMark`，包括 mediaId 为 null 的失效标记；不使用 Artwork.likeCount 代替个人评分事实。

只有 COMPLETED run 可审核和准备计划。`runVersion` 取该完成 run 的 version，之后不因读取或新一轮检测推进；新检测使用新 runId。每个 `(userId,runId,groupId)` 的 reviewVersion 初值为 0，每个 `(userId,runId)` 的 reviewRevision 初值为 0；saveReview 的 CAS 与两者递增同事务完成。reviewVersion 不是组全局版本，另一账户保存不能覆盖本账户选择。

沿用阶段二 Run/Item/Media/Group/GroupMember，新增数据只需下列六类分页表；名称作为实施接口固定，不另建通用工作流或清单框架。

| 表                           | 最小身份与事实                                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ArtworkDedupReviewState      | `(runId,userId)`；reviewRevision，作为该账户审核写入与冻结的短事务锁                                                                                                                                                                                 |
| ArtworkDedupReview           | `(runId,userId,groupId)`；keeperArtworkId、reviewVersion、updatedAt；保留者必须来自该 run 的完整组                                                                                                                                                   |
| ArtworkDedupOperation        | operationId、runId、artistId、requestedBy、idempotencyKey/requestDigest、runVersion、frozenReviewRevision、version、executionVersion、jobId；PREPARE 状态/阶段、选择模式、聚合计数、checkpoint、validatedAt、脱敏错误码、完整根映射、reader 占用证据 |
| ArtworkDedupOperationGroup   | `(operationId,groupId)`；冻结 keeperArtworkId、reviewVersion、选择依据 SAVED/RECOMMENDED；SELECTED/EXCLUDED/BLOCKED 及原因，保留跨页实际范围和跳过项                                                                                                 |
| ArtworkDedupOperationArtwork | `(operationId,artworkId)`；groupId、KEEPER/COPY、冻结 mediaRevision/source revision/mediaEpoch/成员签名/算法；归属、来源引用及整理证据，处理游标与资格/错误码                                                                                        |
| ArtworkDedupOperationFile    | `(operationId,fileId)`；所属 artworkId、来源引用键、文件角色、规范路径和可靠属性/内容证据、归属/检查状态、阻断原因；文件行分页，禁止整清单 JSON                                                                                                      |

Operation 的 `(requestedBy,idempotencyKey)` 唯一。审核行随所属 run/账户管理；OperationArtwork/File 与阶段二历史证据一样，不因实际 Artwork/Image 被删除而级联抹除，保留辨认所需的作品标题/来源快照。复用 ArtworkDedupCommand 的操作者/幂等键记录，为 SAVE_REVIEW/RETRY_PREPARE 增 action 对应的 groupId/operationId 与规范请求摘要；现有检查控制语义不变，expectedVersion/resultingVersion 对应各 action 的业务对象。摘要必须包含所有影响范围的参数，不能仅比较幂等键。先识别相同请求重放，再做当前版本 CAS；返回当前服务端版本，前端不以迟到响应覆盖更高版本。

operation.version 用于操作 CAS/预览游标；重试或 READY/STALE/FAILED 状态切换推进，普通进度 checkpoint 不推进。executionVersion 只隔离不同维护执行，不能代替业务版本。冻结范围在同一 operationId 下不变；新的组选择或保留者创建新 operationId，不以 retry 改写原范围。

## App API 与共享 DTO

现有 start/control 保持不变；getRun 继续返回 `RunDto|null`，artistId 查询仍优先活动 run，再取最近 run。RunDto 增可空且非递归的 `lastCompletedRun:{runId,version,finishedAt,groupCount}` 摘要，供运行中/失败时切回上一份结果；当前就是最新 COMPLETED 时为 null。无记录仍返回 null，不新增 transport 包装。

| 接口                 | 输入                                                                                                       | 结果                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| listGroups（组页）   | runId、expectedUserId、cursor?、limit                                                                      | runVersion、reviewRevision、GroupDto 页、nextCursor、totalGroups、recommendedGroupCount     |
| listGroups（成员页） | runId、expectedUserId、groupId、memberCursor?、limit                                                       | runVersion、reviewRevision、GroupDto 摘要、keeper MemberDto、MemberDto 页、nextMemberCursor |
| saveReview           | runId、groupId、keeperArtworkId、expectedRunVersion、expectedReviewVersion、expectedUserId、idempotencyKey | 已保存 ReviewDto、reviewRevision                                                            |
| prepareCleanup       | runId、expectedRunVersion、expectedReviewRevision、selection、expectedUserId、idempotencyKey               | OperationDto，立即返回稳定 operationId 和 BUILDING                                          |
| getOperation         | operationId、expectedUserId、preview?（ARTWORKS 或 FILES 及独立游标/limit，FILES 可限定 artworkId）        | OperationDto 与该类预览页；默认只有摘要                                                     |
| listOperations       | artistId?、expectedUserId、cursor?、limit                                                                  | OperationDto 摘要页、nextCursor                                                             |
| retryOperation       | operationId、expectedVersion、expectedUserId、idempotencyKey                                               | 原 OperationDto；阶段三条件统一见 [PREPARE reader 恢复与继续](#prepare-reader-恢复与继续)   |

组页/成员页默认 20、上限 100，UI 固定 20；这是对阶段二组页上限 50 的明确升级。操作及文件预览同样默认 20、上限 100。`listGroups` 输入用严格 union 区分两类，拒绝混用 cursor/memberCursor；getOperation 一次只加载一种预览，不能附带全文件清单。

| 共享 DTO          | 必须包含的业务字段                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GroupDto          | groupId、memberCount、fileCount（十进制字符串）、最多 3 个 previewMembers、recommendedKeeperArtworkId/推荐原因、savedReview、needsExplicitChoice、eligibility/reasons                                      |
| ReviewDto         | groupId、keeperArtworkId、reviewVersion；只返回当前账户的记录，无记录为 null/版本 0                                                                                                                        |
| MemberDto         | artworkId、title、现有受保护缩略图、来源摘要、createdAt；ownOrganization（个人评分及有效/失效书签/喜欢计数）、ownReading（lastViewedAt/进度摘要）、otherAccountHasOrganization；不透传整 Artwork/MediaMark |
| OperationDto      | operationId、artistId、runId、runVersion、version、executionVersion、jobId、mode=PREPARE、status、stage、createdAt/updatedAt/validatedAt、counts、allowedActions、failure；不返回 requestedBy 的私有状态   |
| ArtworkPreviewDto | groupId、artworkId、KEEPER/COPY、作品辨认摘要、资格/原因、读取者自己的整理/阅读影响及他人布尔提示                                                                                                          |
| FilePreviewDto    | fileId、artworkId、role、经验证的安全相对名称、sizeBytes、检查/归属状态、requiresReview、阻断原因；不返回原始路径或内部证据                                                                                |

counts 区分 selectedGroups、excludedGroups、blockedGroups、keepers、copies、preparedArtworks、preparedFiles、logicalBytes；不知道总数时返回 null，不用 0 伪装已完成。字节与可能为 BigInt 的文件数量传十进制字符串，日期为 ISO/null。failure 使用固定 code/message；allowedActions 由服务端状态给出，第三阶段只能含 RETRY_PREPARE/REPREPARE，不出现 isolate/restore/purge。

游标使用现有 Zod + 稳定键分页模式，绑定账户、runId/runVersion 或 operationId/version、分页种类与 groupId/artworkId 过滤范围；组按 groupId、成员按 artworkId、文件按 fileId，批次按 createdAt/id 排序。服务端独立验证所有归属，不信任游标携带的范围。错账户、跨 run/组/批次、未知 ID 或过期游标均受控拒绝；不忽略后继续。详情页另带当前保留者摘要，即使它不在当前成员页也可辨认。

## 建议、跨页选择与短事务冻结

唯一带任意账户评分或标记的作品优先保留；多部都有时需要明确选择。无此类记录时按当前账户 lastViewedAt 降序（null 最后）、Artwork.createdAt 升序、Artwork.id 升序推荐；不使用 lastActiveAt 或他人阅读时间。现有 ArtworkReadingSummary.stateVersion 仅代表该账户阅读状态，不能当所有整理数据的统一版本。用户选择只保存保留者，不自动勾选组；未保存选择不能进入准备请求。

selection 严格为 `{kind:'EXPLICIT',groupIds}` 或 `{kind:'ALL_RECOMMENDED',excludedGroupIds}`，两种 ID 数组均去重验证且最多 1,000；EXPLICIT 至少一组，ALL_RECOMMENDED 可无排除项。超过上限明确拒绝，不截断。ALL_RECOMMENDED 的“全部”来自数据库中该完成 run，绝不是当前加载页；已保存选择优先，否则取无歧义建议，无法确定保留者或已知不具资格的组持久记为 EXCLUDED 并说明原因。显式选择遇到无保留者/未知组等错误拒绝整个请求，不悄悄缩小范围。

prepareCleanup 在同一短事务中验证 run/审核 CAS、持久 Operation、冻结全部组/保留者/副本行并入队；用数据库集合语句，不在 HTTP 取出全部成员数组、枚举媒体或访问文件系统。冻结所用建议和有效性来自同一数据库快照。全范围推荐计数是显示时的建议；请求响应与后续预览明确显示实际冻结/排除数量，不能把较早计数当授权。冻结后不因翻页、新 run、新审核或整理变化追加组或替换保留者。

准备前锁顺序采用 run → 本账户 ReviewState → 既有创作者协调 → Artwork ID 升序；PREPARE 执行在现有 resource/job fence 后取得 run/operation/ReviewState，再按同样的创作者/作品顺序复核。saveReview 与冻结均先锁同一 ReviewState。复用阶段一目录/路径/作品锁序；若本批需要目录锁，必须在 Artwork 之前取得，不能在最终作品锁内再补目录或等待 Image 锁。

## PREPARE 执行与证据边界

新增 `ARTWORK_DEDUP_MAINTENANCE@1`，payload 严格为 `{operationId,executionVersion,mode:'PREPARE'}`，使用 BACKGROUND_WRITER、SYSTEM/900。领域 retry 保留原 operationId、冻结范围/根映射，提高 executionVersion，重新关联任务并使旧预览版本失效；若审核或证据已变化则 STALE，不能以重试接受新状态。通用创建、控制、重试、优先级和子任务入口不得绕过领域限制；沿用阶段二任务状态映射、幂等、fenced 提交和脱敏事件模式。

业务状态为 BUILDING → READY/STALE/FAILED；任务 PENDING/RUNNING/RETRY_WAIT 与分页进度不另造业务状态。阶段按 INVENTORY → INSPECT → VERIFY → DONE，checkpoint 持久记录 artworkId、imageId/来源引用键、fileId；单个大作品也能在媒体页之间续跑。数据库读取/写入页上限沿用阶段二 100/500/100，slice 让行、读者进程和退出证明沿用同一预算。仅将受控 reader 的读取能力扩展到必要的属性/有界目录检查，文件 I/O 始终在事务外。

供执行器固定的 helper 边界为 `assertArtworkDedupOperationExecution(tx,{operationId,jobId,executionVersion})`、`readArtworkDedupOperationArtworksPage`、`readArtworkDedupOperationFilesPage`、`saveArtworkDedupOperationFilesPage`、`updateArtworkDedupOperationCheckpoint` 和 `finalizeArtworkDedupPrepare`；分页/写入参数均携带同一 execution，最终 helper 必须与 scope.complete 同事务。内部行类型可来自 Prisma，不能作为浏览器 DTO。失败 CAS、失租约、取消或 DB 异常均不能发布 READY；局部缺失/未知文件可形成完整的 BLOCKED 项，根/环境故障为整操作失败。

读者占用仍全局唯一：Operation 保存与 Run 同形的 readerToken/readerState/readerOwner；claim 在既有全局协调锁下同时检查扫描与 PREPARE 占用，不能各自允许一个。正常关闭、原 token CAS、同机退出证明和离线恢复同样适用；不能把已完成 scan run 的 job 身份冒充维护执行，也不能因 retry 清除未确认退出的读者。这里复用现有占用协议，不新增第二套进程控制或长期作品声明。

当前 schema 没有覆盖全部来源/私人整理的统一 version。OperationArtwork 必须在既有 Artwork 锁下冻结并精确比较：

- 阶段一 source revision/mediaEpoch、成员签名、算法与阶段二媒体证据，以及有效 ArtworkArtist/evidence/艺术家合并状态；不使用遗留 Artwork.artistId 代替多创作者关系。
- 实际 storagePath/storageKey/metaSource、相关外部来源身份与 ArchiveRevision 引用；章节路径/hash/引用另按 Image 行冻结，不能假称 Artwork.mediaRevision 或内容指纹覆盖章节和附件。来源引用的完整性可与分页清单行做集合复核，不能只比较数量。
- 所有账户评分/标记的规范有序值及身份所形成的服务端摘要；包含失效标记，不仅比较数量、最大时间或保护布尔值。推荐时使用的本账户 lastViewedAt 另留选择依据；阅读 stateVersion 用于本账户摘要一致性，不当作评分/标记版本，也不因 lastActiveAt 或自动进度修正重选保留者。摘要只作内部精确变更检查，浏览器不接收摘要或他人明细，不保存全账户大 JSON。

每页结果提交和最终 READY 前检查相关冻结证据，最终检查到发布须保持既有创作者/Artwork 锁和账户审核锁；有变化则 STALE，不重新推荐或悄悄排除已冻结成员。普通评分、标记设置/移除、阅读写入使用作品锁，新增比较沿用它们，不另设全库整理版本。账户删除是已确认的例外：当前 deleteUser 直接删除 UserBA，级联删除 MediaMark 和一级评分时不取得 Artwork 锁，能够越过最终摘要复核。第三阶段必须在实施前明确该入口的事务锁序，并覆盖并发新增整理记录与账户级联删除；不能只在事务外预查作品 ID 后加锁，也不能依赖二至四级评分计数触发器代表所有标记。来源身份写入的窄核对未发现同类提交窗口：Artwork 本行更新或现有发布锁会与最终 Artwork 锁冲突；来源同步时间和失败状态不纳入文件身份摘要。

READY 表示 validatedAt 时完成的清单快照，不是持续监控文件系统或隔离授权。BUILDING 期间的变化、后续受保护读取/复核观察到的变化、审核代次变化均使计划 STALE；getOperation 不为每次轮询重新扫描几十万文件。事务外文件变化不保证即时发现，必须展示验证时间；后续隔离仍须重新取得全局声明、复核全部源/成员/归属/整理并完整重读。不得将“尚未观察到变化”写成“当前可安全隔离”。

计划保存管理事实和内部冻结证据；ownOrganization/ownReading 按实际读取者投影，不直接复用发起者摘要。另一账户可以查看批次及请求原范围重试，不能读写发起者的审核选择；冻结审核代次仍绑定最初 requestedBy。

## 文件角色与最小清单字段

PREPARE 不隐藏作品、不移动/删除文件、不认领长期作品声明。可复用现有纯路径校验和归属规则，不能复用 App 删除预览把全部图片/文件存入 Map/数组的执行方式。清单的 keeper 和 copy 均有来源/成员证据；仅 copies 进入未来待隔离范围。

| role        | 来源与额外证据                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| MEDIA       | Image.id/path、阶段一媒体 sourceRevision 与阶段二完整 sha256；保留原媒体一一对应身份                                                         |
| CHAPTER     | Image.id、chaptersPath/chaptersHash/chaptersUpdatedAt，验证章节文件命名和引用；不是独立 Chapter 表，也不是原媒体内容相等证明                 |
| SOURCE_FILE | Artwork.metaSource 或明确 ArchiveRevision.manifestPath 等真实文件引用及身份校验依据；ArtworkSourceSnapshot 是数据库 JSON，不能虚构为文件路径 |
| ATTACHMENT  | 发现来源、独占归属证据、requiresReview；未有明确文件审核事实不得自动纳入                                                                     |
| UNKNOWN     | 无法确认归属的发现项，只记录受限位置摘要和阻断原因，保持原位                                                                                 |

每个文件行至少保存 operationId/fileId/artworkId、role、imageId/revisionId 等来源引用键、logicalRoot/rootIdentity/规范相对路径、可靠 stat 的 size/mtimeNs/ctimeNs/deviceId/inode/linkCount/type、适用的媒体 sourceRevision/sha256、ownershipStatus、inspectionStatus、requiresReview/blockReason。不存在或不适用的属性为 null，不能伪造零值；身份/摘要不向 UI 输出。完整根映射包含逻辑根、物理根身份与 archiveRelativePrefix，延续阶段二 rootBindings 的版本规则。

同一路径的多项引用不能被去重后隐藏；以稳定来源引用键幂等落文件行，跨作品/跨角色重复引用留证并阻断。逻辑字节只对可纳入范围内的唯一规范根/路径求和，不按引用行重复累加，不宣称等于即时释放空间。硬链接、符号链接、共享引用、跨文件系统、未知附件和未审核旧 ArchiveRevision 均返回不可自动执行原因；未知目录不能仅靠“与图片同目录”认领。

仅已证实独占的目录允许有界分页检查遗漏；Pixiv 平铺仅检查精确已知文件。目录扫描需要可续跑游标、深度/条目预算及越界状态，超限不能标为完整。未来隔离目标尚不存在时，本阶段不能声称已证实目标文件系统兼容，必须保留后续必检项。

## 页面与未决实现边界

沿用[页面设计](./ui-design.md)：两标签、作品行、桌面侧栏/手机全屏详情、跨页选择底栏。顶部保持标题、短状态和主操作；不展示内部版本、哈希或大量缩略图。切换账户清空详情/选择缓存，异步响应按账户/run/业务版本接纳。阶段三 READY 只有预览，隔离区框架不借用旧归档回收站的七天自动清理规则，也不返回可执行隔离的按钮或后端模式。

[第三阶段计划](./03-review.md)允许明确审核的附属文件纳入，但目前 API 没有文件级审核输入，现有 schema 也没有可复用的审批事实。可展示已归属的 ATTACHMENT 候选，首轮 PREPARE 不等于审核；UNKNOWN/未审核项阻断，组勾选不能伪造 APPROVED。若后续开放纳入，须先定义绑定 operation.version + manifest fileId 的明确复核输入，再同步契约/UI；当前不能宣称已支持，不以修改原规格降低要求。

实现分工：数据负责上述表/正式迁移、审核/冻结/保护查询、API/DTO、领域任务提交与 DB helper；执行器负责 PREPARE、受控检查、checkpoint 和 Worker 注册；UI 负责持久审核、分页选择、账户隔离和预览。跨模块按以下维护扩展并行实现隔离与永久清理；实际入口仍由同一阶段门禁依次开放。

测试以 D3-01 至 D3-08 为准；D3-06 必须覆盖冻结/最终 READY 之间的并发修改及后续观察到变化后的失效，不能用时间超时冒充内容校验。50 万清单、真实文件样本及故障分别留证。组件测试不能替代最终 D3-B01/B02 浏览器验收。所有实现与定向验证按 2026-10-24 并行职责推进，不修改仍在执行的第二阶段基准副本或规模库。

## 2026-10-24 维护扩展与冻结的导出

当前分支共享门禁 `ARTWORK_DEDUP_RELEASE_STAGE=3`，仅开放审核、PREPARE/ISOLATION目的的只读准备与预览；隔离、恢复、永久删除、PREPARE/PURGE预检及显式重导继续由真实API和执行器拒绝。阶段三数据和Worker编排独立审查已通过，浏览器及50万PREPARE清单验收仍待完成，不据此宣称完整最终验收。`assertArtworkDedupMaintenanceModeEnabled(mode)` 对 PREPARE 要求 3、ISOLATE/RESTORE 要求 4、PURGE 要求 5。App 领域入口与 Worker/Executor 任务入口都调用；类型注册不等于开放，只有对应保护测试/独立审查通过后由统筹推进此单一常量，禁止仅靠隐藏 UI 或环境开关放行。purge 预检 PREPARE/PURGE 同样要求阶段 5。

维护 payload 固定为 `{operationId,executionVersion,mode:'PREPARE'|'ISOLATE'|'RESTORE'|'PURGE'}`。Operation 增 `mode/originalAction`、`preparePurpose:'ISOLATION'|'PURGE'`、cancelRequestedAt、backupCheckpointRef/confirmedAt、purgePreviewVersion/purgePreviewValidatedAt、授权范围摘要/版本；所有行保留原操作身份。业务状态为 BUILDING/READY/STALE/FAILED/ISOLATING/ISOLATED/RESTORING/RESTORED/PURGING/PURGED/RECOVERY_REQUIRED/CANCELLED。originalAction 决定失败后可继续的动作，客户端不能用 retry 切换它。

新增四类保护表：`ArtworkDedupClaim` 以 artworkId 唯一，绑定 operationId、KEEPER/COPY、executionVersion；`ArtworkDedupSourceIdentity` 以稳定 identityKey 唯一，保存受信根/来源身份、generation 与 OPEN/HOLD/TOMBSTONE 状态；`ArtworkDedupOperationSource` 绑定 operation/item/source 与冻结 generation，来源证据不依赖 Artwork FK；`ArtworkDedupFileReceipt` 保存每个 operation/file/执行版本/文件步骤的持久 intent/receipt。URL hold 从未终结的 OperationArtwork/来源 HOLD 推导，不借普通归档 purgeAfter 表示。非 URL PURGE 把来源变为 TOMBSTONE，显式 allowReimport 才原子推进 generation 并变 OPEN，旧 generation 发布仍拒绝。

OperationArtwork 增状态 SELECTED/BLOCKED/ISOLATING/ISOLATED/RESTORING/RESTORED/PURGING/PURGED/RECOVERY_REQUIRED，来源类型、isUrl、manifestDigest/manifestPersistedAt、freshContentSha256/freshMembersSignature/freshVerifiedExecutionVersion、文件计数和错误；itemId 对外等于该行 artworkId（整数，限定 operation）。OperationFile 增 isolationRelativePath、状态 PENDING/VERIFIED/MOVE_INTENT/MOVED/RESTORE_INTENT/RESTORED/DELETE_INTENT/DELETED/BLOCKED、版本与收据；磁盘清单摘要及持久化证明必须先提交，随后才隐藏副本并准许首个 rename。未知附件不因这些扩展变成已批准。

Zod/TS 单一导出位于 `job-contracts/src/artwork-dedup-maintenance.ts`：`ArtworkDedupGroupDto`、`ArtworkDedupMemberDto`、`ArtworkDedupReviewDto`、`ArtworkDedupListGroupsDto`、`ArtworkDedupOperationDto`、`ArtworkDedupArtworkPreviewDto`、`ArtworkDedupFilePreviewDto`、`ArtworkDedupOperationResponseDto`、`ArtworkDedupMaintenancePayload`。组/成员响应用 `kind:'GROUPS'|'MEMBERS'`，成员页始终有 group/keeper/items；操作详情为 `{operation,preview:null|{kind,items,nextCursor}}`。Member 私有字段固定 `ownOrganization:{rating,bookmarks:{available,unavailable},likes:{available,unavailable}}`、`ownReading:{lastViewedAt,seenCount,totalCount,stateVersion}|null`；他人仅布尔提示。

领域方法/Zod 输入以既有 `artworkDedup` router 命名：saveReview、prepareCleanup、getOperation、listOperations、isolate、restore、preparePurge、purge、retryOperation、cancelOperation、allowReimport。相应 schema 使用 `artworkDedup<Name>InputSchema`。isolate 绑定 operationId/expectedVersion/expectedUserId/idempotencyKey，要求 externalWritesStopped、backupCheckpointConfirmed 和 backupCheckpointRef，受保护副本另要求 organizationImpactConfirmed；不收路径/hash。restore/purge 使用 `selection:{kind:'ALL'}|{kind:'EXPLICIT',itemIds:number[]}`（最多 100）；purge 另要求 permanentDeleteConfirmed 及同版本备份/停写确认。retry 只恢复原动作/授权范围，optional itemIds 只能缩小到原未完成项，不能扩大；cancel 在首个移动前安全撤销，开始后转 RECOVERY_REQUIRED。

preparePurge 是只读异步预检，复用 PREPARE + preparePurpose=PURGE，不新增任务模式。它冻结完整 ISOLATED 项，fresh 校验保留者/隔离文件后保存 purgePreviewVersion，仍保留 ISOLATED；UI 显示这个预检与明确删除后果后才可提交 purge。purge 要求匹配预检版本，执行时再次 fresh 复核。allowReimport 输入原 operation/version 与 `sources:[{sourceId,expectedGeneration}]`（最多 100），只接受本批已 PURGED 项的 TOMBSTONE；返回更新后的操作/来源代次，不宣称文件恢复。

DB 执行 helper 的公共 execution 固定 `{operationId,jobId,executionVersion}`。页读 `readArtworkDedupOperationArtworksPage(tx,{execution,afterArtworkId?,limit?})` 返回 Prisma OperationArtwork[]（上限100）；`readArtworkDedupOperationFilesPage(tx,{execution,artworkId?,afterFileId?,limit?,statuses?})` 返回 File[]（上限500）。`readArtworkDedupInventoryPage(tx,{execution,artworkId,afterImageId?,limit?})` 返回 `{artwork,images,nextImageId,sourceReferences,blockReasons}`，images 仅 id/path/chaptersPath/hash/更新证据，上限500；sourceReferences 仅有界真实 metaSource/Revision 文件引用，无法证明独占/完整的旧归档直接阻断。全局重复引用检查在 DB helper，Executor 不自己查询全库数组。

`saveArtworkDedupOperationFilesPage(tx,{execution,entries})` 上限100，以稳定 referenceKey 幂等；`updateArtworkDedupOperationCheckpoint(tx,{execution,data})` 只允许阶段/计数/游标；`finalizeArtworkDedupPrepare(tx,{execution})` 与 scope.complete 同事务。`claimArtworkDedupOperationReader`/`recordArtworkDedupOperationReaderOwner`/`releaseArtworkDedupOperationReader` 与扫描共享全局占用；release 接原 token，确认实际退出后允许失租约清占用，但不发布业务结果。

`claimArtworkDedupOperation(tx,{execution})` 按 Artwork ID 升序认领冻结 keeper/copy 和来源；`assertArtworkDedupWritable(tx,{artworkIds,intent:'CONTENT'|'ORGANIZATION'|'READING',execution?})` 供 App/执行器共用，READING 只允许被认领的 keeper，其他外部写拒绝。`assertArtworkDedupSourcePublication(tx,{identities,execution?})` 检查 source generation，不能仅查现有 Artwork；新任务捕获当前 generation，最终发布必须携带它。URL 到期选取、任务物化、现存任务执行前和普通恢复都查询同一 hold；下载 generation drain 仍由既有 staging 协议证明，lease 过期不是已退出。

逐文件执行调用 `beginArtworkDedupFileStep(tx,{execution,fileId,step:'MOVE'|'RESTORE'|'DELETE',expectedFileVersion})` 返回冻结 File/receipt；完成使用 `finishArtworkDedupFileStep(tx,{execution,fileId,step,expectedFileVersion,receipt})`，收据只含受信属性/位置与同步证明。`recordArtworkDedupFreshEvidence` 保存该执行版本的 keeper/copy 强制哈希；`recordArtworkDedupManifest` 保存磁盘清单摘要与持久化证明；`finalizeArtworkDedupMaintenance(tx,{execution})` 仅在全部文件/业务步骤满足时完成状态、业务删除和 tombstone，否则不得释放声明。恢复冲突不覆盖，PURGE 恢复只能继续原 DELETE 意图。

账户删除限定修改现有 deleteUser：在一个事务中按稳定顺序锁 User 行并核对最后账户，再在该锁下取级联评分/标记/阅读涉及的 Artwork 集合，按 ID 取 FOR UPDATE NOWAIT 后删除。User 的 FOR UPDATE 与新评分/标记的 FK KEY SHARE 串行；已有 Artwork→User 的写者造成冲突时，NOWAIT 使删除整个事务回滚并报告可重试冲突，禁止持有 User 锁无限等待作品锁，也不能事务外预查集合。新标记若尚未取得 FK 锁，账户删除后只能失败回滚，不能漏入级联范围。真实 PG 必须覆盖此交错和最终 READY 窗口。

组页与成员页增加服务端 `allowedActions:('SAVE_REVIEW'|'PREPARE_CLEANUP')[]`，门禁未到 3 或 run 无效时为空。所有游标独立限长 2,000，不使用业务 ID 的 128 字符限制。REPREPARE 使用 prepareCleanup 的严格输入分支 `{sourceOperationId,expectedOperationVersion,expectedUserId,idempotencyKey}`；服务端从旧 OperationGroup 冻结行重建同一组集合并重新取得当前账户审核/建议，生成新 operationId 和实际预览，不把完整 groupIds 返回浏览器，也不借 retryOperation 扩大范围。

### 第一批实际调用补充

`saveArtworkDedupReview`、`freezeArtworkDedupOperation`、`readArtworkDedupGroupChoices`、`completeArtworkDedupPrepare` 与 `validateArtworkDedupOperationSnapshot` 从 DB 包导出。最终 PREPARE 在既有 resource/job fence 后依次锁 run/operation、原操作者 ReviewState、创作者协调、作品 ID 升序，直到同一 `scope.complete` 提交；ReviewState 消失、审核 revision 变化，或内容/来源/手工整理/创作者签名不等均 STALE。阅读事实不进入授权签名。READY 还要求媒体、章节与已登记来源文件都存在于已完成清单，不接受只有聚合计数的空清单。媒体和章节的清单引用键固定为 `media:<Image.id>`、`chapter:<Image.id>`；最终完整性复核使用已有 `(operationId,referenceKey)` 唯一索引定位，并同时核对 artworkId、imageId 和 role，不能只凭键相同认定成员存在。这样每个登记成员只定位其对应清单行，不按成员反复扫描整部作品清单。

`OperationArtwork.inspectionCheckpoint` 仅保存有界目录 DFS 状态：version=1、visited 上限 10,000、stack 深度上限 12，每帧 relativePath/afterName 及目录 dev/inode/mtimeNs/ctimeNs；不含文件全集。Inventory 的 SOURCE_FILE 引用带 `rootKind:'SOURCE'|'ARCHIVE'` 与 `expectedIdentity`：PIXIV_METADATA 使用既有 scan metadata 解析器核对 externalId（json/txt），ARCHIVE_MANIFEST 核对 revisionId/provider.key/provider.externalId，完整媒体清单须按持久分页证据复核。无法核对的 metaSource 阻断，不能仅凭文件存在或后缀接受归属。CHAPTER 跟随其 Image 的真实根映射及已登记 chaptersHash。收据允许额外 observedMtimeNs/observedCtimeNs/sha256；大小/设备/inode 都用十进制字符串。

账户删除实际采用 UserBA ID 升序 `FOR UPDATE NOWAIT`（保留最后账户约束并阻止新外键插入），再锁目标账户 ReviewState，查询其真实评分/标记/阅读涉及的 Artwork 并按 ID 升序 `FOR UPDATE NOWAIT`。正常写者可保持 Artwork→User FK 顺序；一旦反向争用，删除整笔事务回滚并返回受控冲突，不能在事务外先查 ID。已被维护声明的手工整理事实也拒绝级联删除。

### 首批差异修订与 PREPARE 接口闭合

READY 要求每个文件 `inspectionStatus/ownershipStatus/status` 均为 VERIFIED；任一 PENDING/失败/阻断均不能发布 READY。ALL_RECOMMENDED 为 run 完整组集合持久化 OperationGroup，用户排除为 EXCLUDED/USER_EXCLUDED，资格排除同样计入 excludedGroups，仅 SELECTED 生成 OperationArtwork。FILES 预览如指定 artworkId，先校验 `(operationId,artworkId)` 成员；跨操作/未知 ID 拒绝，合法尚无文件的成员才返回空页。

`validateArtworkDedupOperationSnapshot(tx,operationId,artworkId?)`：页提交提供单一 artworkId，仅复核这一项；默认全范围只用于最终完成。`saveArtworkDedupOperationFilesPage` 覆写 ownershipStatus，以数据库内已绑定根映射核对全库登记媒体、章节、metaSource、Revision manifest 及本操作其他角色/条目引用；调用者只能提交检查结果，不能自己声明归属已通过。跨作品、跨角色、无法匹配登记引用的文件持久 BLOCKED；UNKNOWN/未审核附件保持阻断。最终完成再次批量核对全部清单，避免先前页证据被后续登记变化淘汰后仍发布。归属核验完整计算所有行，但每次仅持久化状态真正变化的前100条（fileId稳定排序），返回 changedFiles/updatedFiles/totalFiles 计数；分页保存本身上限100，因而正常页能保存全部结果。最终复核若 changedFiles 大于 updatedFiles，说明已完成页之后存在大范围待更新证据：同一完成事务将 operation 标为 STALE、errorCode=OWNERSHIP_CHANGED、logicalBytes=null、preparedFiles=totalFiles，保留冻结范围和首批真实文件诊断，绝不发布 READY。未回写行仍属于该失效快照；重新 PREPARE 才逐页生成完整现状诊断，不能将余下旧 VERIFIED 标签视为有效授权。小范围变化全部回写后沿既有 BLOCKED/FAILED 判定；不变行不刷新 updatedAt，验证时间由 operation.validatedAt 表达。引用先按唯一根/路径聚合后与文件行匹配，不对每条文件反复扫描全部引用，也不构造共享路径的两两关系。

logicalBytes 仅统计 COPY 可纳入且唯一(rootIdentity,canonicalPath)的文件大小；keeper 不计入，同路径不重复累计。任一 COPY 范围存在未确认/阻断/未知大小时为 null；preparedFiles 始终是实际所有清单行数。

归档来源清单优先沿用 ArchiveImport 与已 sealed/drained generation 的同一 sealedManifestSha256。新增 `readArtworkDedupArchiveManifestEvidence(tx,{execution,artworkId})` 返回严格匹配当前唯一 revision、provider/externalId、已发布 Artwork 和真实 ArchiveImportItem→Image 路径/大小的封印摘要及成员数；不存在完整封印证明则明确阻断，不能猜 Image 排序代表 pageIndex。Inventory 的每页 media 同时返回真实 importItem(pageIndex,stagedPath,sha256,byteCount)有界映射。reader 对原 manifest 完整读取一次并核对身份和封印摘要，即证明与当初发布的完整清单相同；不每100条重新读取大 JSON。源文件上限16 MiB，超过上限阻断。

新增只读 `GET /api/artwork-dedup/cover/:artworkId?expectedUserId=...`。DTO 只含此 ID URL，不返回原路径；路由独立调用 Better Auth Session，匿名401、账户变化403、无效ID400，不存在/回收/隔离隐藏作品404。对当前有界作品集合只选择第一登记媒体/已有视频poster，不做全库扫描、不生成封面、不在请求内重编码。文件读取复用既有安全根解析及派生媒体路径，拒绝隐藏路径；返回 `Cache-Control: private, no-store`、`Vary: Cookie`，不重定向原文件URL，不跨账户缓存。没有已生成视频封面或隔离批次无法读取时保留占位。

### PREPARE reader 恢复与继续

在线 `releaseArtworkDedupOperationReader(tx,{execution,readerToken,blocked?})` 只由受控执行器在实际 close 或既有固定同机退出证明后调用；`blocked:true` 保留原token，lease过期不构成退出证明。未知主机/启动期间无owner必须走显式离线恢复。

离线 DB 接口固定 `inspectArtworkDedupOperationReaderRecovery(tx,{operationId,now}) -> {snapshot,digest}` 与 `recoverArtworkDedupOperationReader(tx,{operationId,expectedDigest,expectedReaderToken,operator,confirmAllWritersStopped,now}) -> {operationId,recovered:true}`。沿既有 dispatcher 协调锁→writer lane/job→run/operation 顺序，核对所有执行/租约/Worker心跳停止，摘要绑定 operation版本、executionVersion、job/attempt/status、原reader token/state/owner。操作人员全停写确认只是必要条件；摘要/token/活动执行不符全部拒绝。成功只清本reader占用、推进业务version并审计，不改冻结内容、范围、业务状态或原媒体。CLI的 run/operation 选项严格互斥，不提供公开SQL清token入口。

共享 `isArtworkDedupPrepareRetryable(operation,job,now)` 给 DTO 与真实 mutation 使用：仅原PREPARE/ISOLATION、无取消意图、reader为IDLE且token为空、job身份/payload/执行版本匹配、无有效租约，并且 operation=FAILED 对应 job=FAILED，或 operation=BUILDING 对应 job=PAUSED。继续仍使用既有 retryOperation 的账户/幂等/版本CAS，保留operationId/冻结范围，新 executionVersion 入队；不把暂停伪装失败，不把未退出reader的重试开放。门禁未达3时 DTO不给入口且真实API拒绝。
