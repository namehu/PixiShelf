---
status: draft
scope: 去重声明的 App 写入口分类与分批接线；不代表全写守卫已完成
last-verified: 2026-10-24
sources:
  - docs/security/access-control.md
  - docs/design/artwork-deduplication/claims-contracts.md
  - packages/pixishelf/services/reading-service.ts
  - packages/pixishelf/services/artwork-rating-service.ts
  - packages/pixishelf/services/media-mark-service.ts
  - packages/pixishelf/services/artwork-service/content-source-guard.ts
  - packages/pixishelf/services/artwork-service/deletion-content-guard.ts
---

# App 写入口接线

> 2026-10-24 范围调整：本页只保留写入口盘点与已接线细节，后续授权改为[直接删除](./direct-delete.md)。隔离/恢复/PURGE 相关表述仅用于理解旧调用位置，不是新目标。第一批必须收口[暂停交接](../../records/artwork-deduplication-resume-pause-2026-10-24.md)中的媒体/章节 WIP、隐含 catalog 锁及删除安全必要入口，并取得独立审查；当前不声称全部入口完成。旧 stage 3 保持，新独立删除能力门禁关闭。

复用[声明契约](./claims-contracts.md)；门禁保持3。本文记录本轮精确接点及尚待覆盖的入口，不授权文件动作，也不以部分接入替代 D4-02 全写入口验收。来源发布的 generation、下载 drain 和执行器接点由执行器线继续核对。

## 第一小批：阅读和个人整理

新增 `services/artwork-dedup-write-guard.ts` 导出 `assertArtworkDedupAppWrite(tx, artworkId, kind): Promise<void>`。只适配现有 DB 守卫的错误：ARTWORK_CLAIMED→固定维护中 CONFLICT，NOT_FOUND→NOT_FOUND；数据库及其他未知异常不吞掉。不得加入绕过参数。真实用户仍来自 Session；服务接收路由验证后的 userId。

| 入口                                         | 原事务与账户边界                                                                              | 本批接点                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| reading.context / artwork.reader             | authProcedure 对 expectedUserId 比较 Session；服务锁 Artwork，reconcileSummary 可能写阅读摘要 | getReadingContext / getReaderInitialization 在原事务、Artwork 锁后调用 READING；COPY 拒绝，KEEPER 继续 |
| reading.report / summaryGroupRead / markRead | 同上，媒体版本、作品/组归属仍由现有流程验证                                                   | reportReading / markReadingRead 在原事务、Artwork 锁后调用 READING，早于阅读行写入                     |
| artworkRating.set（含 null 清除）            | Session/expectedUserId，锁 Artwork，读写本账户 ArtworkLike                                    | 活动可见性验证后、个人行读写前调用 ORGANIZATION，keeper/copy 都拒绝                                    |
| mediaMark.set / remove                       | Session/expectedUserId；remove 先以 markId+userId 找 Artwork，再锁并重读                      | 原事务内调用 ORGANIZATION；不接受调用方替换 mark 所属 Artwork；无标记的幂等 remove 仍无写入            |

这些 helper 不显式取来源或根锁；实际事务仍须核对评分等触发器是否 UPDATE Artwork 并隐含取得 catalog。不能沿用“不显式调用 catalog 就无倒序”的结论；有该隐含写入时按既有 catalog 在前的顺序接入。保留既有 Artwork→User FK 顺序；用户删除现有 User 锁+Artwork NOWAIT 协议在冲突时回滚删除。KEEPER 的最近阅读可继续，阅读 stateVersion/lastViewedAt 不能被用作隔离授权的内容或整理失效条件。

只读评分/标记列表、阅读摘要/历史查询无此写守卫；它们继续使用现有账户及可见性过滤。reader/context 虽是查询 transport，因会修正摘要所以属于本批写入口。隔离后的媒体可见性及浏览权限仍是后续完整生命周期验收的一部分。

## 其余精确接线清单

| 范围与文件                                                                                                                                                           | 已有覆盖                                                                                                                                                                          | 后续缺口与事务位置                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user-service.deleteUser → DB deleteUserWithArtworkDedupProtection                                                                                                    | 阶段3已接 User 锁阻止新 FK、Artwork 升序 NOWAIT；拒绝被声明作品的评分/标记级联删除                                                                                                | 本批不改用户权限或删除协议；仍需在阶段4全入口矩阵复用真实并发证据                                                                                                                  |
| image-manager.reorderArtworkImages                                                                                                                                   | 已有 Artwork 锁、旧完整顺序比较                                                                                                                                                   | 第二小批已接同事务 STRUCTURE；不反向调用来源 helper                                                                                                                                |
| image-manager.addImage / addImageWithChapters / associateChaptersToImage / clearChaptersForImage / reconcileArtworkImages / updateArtworkImagesWithTransactionClient | 部分上传发布通过 publishContentOwner，扫描通过 assertContentScan；单靠 Artwork 锁并不检查 Claim                                                                                   | 分别在最终注册/重建事务 Artwork 锁后接 STRUCTURE/CONTENT；先保持现有根快照/目录锁顺序，不能把源检查插到 Artwork 后                                                                 |
| artwork-service.index.updateArtwork、manual-storage；artist-service 删除/归属变化、creator maintenance                                                               | 已有 catalog 或 Artwork 锁，部分入口只锁 catalog                                                                                                                                  | updateArtwork 已接 STRUCTURE；其余方法仍须先 catalog、再 Artwork ID 升序核对；任务排队时检查不足                                                                                   |
| media-upload / media-chapter-upload / image-replace-session → content-source-guard                                                                                   | beginContentUpload / beginContentDirectoryWrite 经 beginMediaContentPathWrite；新增来源 hold 检查。内容写者经 beginMediaContentSourceWrite 已拒绝 Claim；活动声明反向阻止维护认领 | 新上传与替换的初次声明已受两原语保护；已完成上传收据的迟到注册、scan 快照发布、新建同来源和无旧 Artwork 发布仍要来源 generation/最终事务检查，不称全部已覆盖                       |
| delete-artwork / image-manager.deleteImage 等 → deletion-content-guard.executeDeletion                                                                               | 删除原文件前同事务先根声明，再内容声明；新删除和重试 path begin 都受来源 hold；活动删除声明反向阻止认领                                                                           | 元数据删除分支和 URL 分流仍要 DELETE/URL hold；全局来源锁不得在既有 Artwork 锁后反向取得                                                                                           |
| archive-trash-service.restoreArchiveTrash → archive-maintenance-service                                                                                              | 统一 archive publisher advisory lock 和领域任务物化；当前仍按普通 purgeAfter 拒绝过期恢复                                                                                         | 必须在领域物化、到期候选/已排队任务/实际删除前核对持久 URL hold；去重直接删除不得先转普通回收/恢复；未终结持久 hold 仍须被普通维护入口遵守。App 与 executor 分批协调，不在本批改动 |
| migration-service、scan-service、来源同步、本地导入和归档发布                                                                                                        | 部分有 catalog/Artwork 锁或目录快照；不等于来源抑制                                                                                                                               | 最终发布事务补来源身份/generation 与已有 Artwork 守卫；先收敛双方锁序。来源清单由执行器线盘点，不另造协议                                                                          |
| tag-service.updateTag / deleteTag 与 artworkTag 级联                                                                                                                 | 标签管理不是两内容写原语覆盖的路径                                                                                                                                                | 若修改/删除关联标签会改变冻结作品结构，后续结构小批需核对全范围 Artwork 锁与 Claim；不能只守卫 artwork.update                                                                      |
| 用户设置、账户/登录、快捷筛选与其他非作品私有状态                                                                                                                    | 当前无待隔离原媒体/作品整理事实写入                                                                                                                                               | 不扩大成通用权限重构；保持现有权限语义                                                                                                                                             |

现有 `artwork.update/reorderImages` 等实例共享编辑输入没有 expectedUserId；它们不是本批个人状态入口，不能假称已有账户切换校验。后续若增加账户绑定需同时改对应 Schema、UI 调用与 auth 回归，由统筹者明确分批；本批不默默新增必填字段造成旧客户端失效。上传/替换已有 expectedUserId 与 Session 比较，删除/归档命令从 ctx 取得操作者并绑定持久幂等计划，后续守卫不得改用客户端 userId。

## 验证边界

第一小批使用独立 PostgreSQL 的真实 Claim + 实际 App service 调用，证明副本四个阅读入口拒绝且不写、保留者继续阅读、双方评分和标记增删拒绝、无声明时原功能有效。Claim 建立协议已由独立 DB 批验证，本批夹具直接持久化 Claim，不重跑完整删除流水线。现有路由匿名/账户变化测试只针对受影响阅读、评分、标记；不运行全量 build/test。完整 D4-02 尚须覆盖上述后续入口及实际来源发布交接。

## 第二小批：单作品元数据和媒体排序

仅接 artwork-service/index.ts 的 updateArtwork 与 image-manager.ts 的 reorderArtworkImages，沿用同一 App error adapter。前者在含 creatorIds/artistId 时先取既有 catalog，再由 STRUCTURE 守卫锁定 Artwork；标题、说明、sourceDate、标签单独写入也先经过守卫，不能只在文本分支锁行。守卫在同一事务的 artwork.update、editArtworkCreators、artworkTag 删除/新增之前完成。

排序沿原 Artwork 锁，再执行 STRUCTURE，保留 expectedImageIds 与完整成员核验。本批不改新建作品、艺术家级删除/合并、全局标签级联、媒体/章节注册或文件路径。元数据和排序继续使用 Session 下的实例共享编辑，不改原 Schema 或添加 expectedUserId 必填字段。

验证使用真实 PG 的 keeper/copy Claim 夹具，确认文本、标签、日期、单作品创作者关系及排序均拒绝且零写；无声明时标签来源、文本 override、日期和顺序 CAS 保持原行为。只跑新 PG 文件、旧 update-artwork-tags 与 image-manager 排序用例。

## 第三小批：新输入冻结与收件意图

CLIENT_LIST、定点重扫与本地目录导入继续在原 `afterEnqueue` 事务中创建冻结输入。一次调用 DB 的有界 `captureArtworkDedupSourceGroups`，每输入一至两项、沿现有最多10000输入预算；DB统一取得所有根协调与去重排序来源锁。不得逐输入循环调用单身份 helper。Pixiv 输入绑定纯路径解析出的 PROVIDER 与该 metadata 精确 PATH；只有 `LOCAL_DIRECTORY` 可使用 DIRECTORY。受信 rootIdentity 由既有 `resolveMediaContentRoots` 及 inventory 根绑定校验产生。旧任务复用只校验原证明，缺证明拒绝，绝不覆盖已冻结行。

审计 Apply 严格解析并核对原观察和原冻结输入的同一证明后复制到新 Apply 输入；缺失或不一致返回 ITEMS_NOT_ELIGIBLE。该流程不捕获新代次，执行前及发布时仍须由 Executor 核验原证明。

归档 Provider 的 `identifySource(input)` 是无网络同步解析；E-Hentai 的 `/g` 和 `/s` 共享严格 URL 身份解析，gid 必须是正安全整数。App wrapper 保留原错误传输边界。新 Intake 在原 submission/RESOLVE 排队事务内、creator catalog 后一次分组捕获 PROVIDER 证明；修改链接产生的新项沿同一入口。Uploader提交复用此入口。DUPLICATE 与容量失败审计行不伪造可执行证明。收件箱和通用后台任务的原项重试均保留原证明，null、非法或 identity 不匹配均拒绝并要求新提交；UI只展示是否具备原意图证明，不向客户端暴露其sourceId/generation。取消与失败回执不受该检查阻止。

本节为本批接线契约，具体已验证范围见本批 records；完整写入口、扫描/归档消费与来源释放仍需各批验收，门禁保持3。

## 第四小批：媒体和章节注册、手工存储分配

本批只覆盖实际 App 媒体/章节登记事务及手工作品存储路径分配，不改已审查的阅读、评分、标记、updateArtwork和reorder逻辑，也不开放文件维护动作。

- `image-manager` 的整体媒体重建、普通扫描reconcile、单图直接登记和上传完成后的实际publication，在已有根/路径写声明之后、Image/章节/派生标签写入之前调用同事务 CONTENT 守卫。KEEPER与COPY均拒绝。COMPLETED上传回执若仅重读既有Image，仍保持真正无写的幂等返回；不得通过该分支更新媒体或来源。
- 章节关联与无文件清除在同一事务先锁Artwork并核对Image归属，再执行CONTENT守卫及Image更新。章节文件上传已知目标Artwork，因此在开始文件工作前做只读事务检查，并在同一begin根/path事务将视频Image纳入既有内容写声明（首次章节路径本身尚无Image映射）；最终publication回调再次检查并沿原token释放声明；开始与最终拒绝都映射既有HTTP409/404。普通原始媒体上传在取得Artwork身份前仍只按受信路径和既有内容写声明保护，不从平铺父目录推断Artwork；最终登记必须检查真实目标Artwork。
- 手工创建空作品沿原creator catalog与新Artwork事务，分配存储路径前调用STRUCTURE守卫；新作品没有外部来源或原媒体，不伪造来源证明。旧空手工作品修复调用同一分配入口，已有Claim时拒绝路径/目录映射写入；没有实际修复的只读返回保持原样。
- 原失败、取消、恢复所需控制回执不加入新的OPEN检查，保留原owner/token/fence；不把媒体提交拒绝转换成取消或伪造完成。

艺术家/creator全范围、全局标签、删除和URL hold/publication retry由后续独立批接入，不能以本批作为D4-02完成依据。

## 第一批收口边界

评分及用户删除评分级联会由触发器更新 Artwork，必须在 Artwork/User 锁前取得现有 creator catalog。扫描 Pixiv/Local/审计 Apply 在最外层最终事务首次根锁前取得 catalog。普通删除的 begin 和最终 publication 同样先 catalog，不能在 verifyMembers 回调才首次取得。

全局标签/艺术家修改、creator 来源关系更新和重映射在同一事务核对受影响 Artwork 的 Claim；涉及集合的变更按 Artwork ID 升序锁定，修改关联关系的入口沿 catalog 串行。归档普通维护及重试必须保持原来源证明和持久 URL hold；控制/失败/退出回执不附加 OPEN 检查。系列成员、排序、系列元数据和级联删除会改变冻结整理影响，复用 catalog 与受影响 Artwork 升序守卫；creator-maintenance SERIES、Pixiv 来源同步及艺术家合并在最终事务检查同一范围。迁移首次目录写声明与发布先 catalog；分配 storageKey 也须核对 Claim。新删除仍关闭，未验证接点以本批记录逐项列明。
