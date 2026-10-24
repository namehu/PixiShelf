---
status: draft
scope: 去重直接删除复用的作品/来源声明与证明基础；生产写保护及新授权待验收
last-verified: 2026-10-24
sources:
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-db/src/media-content-common.ts
  - packages/pixishelf-db/src/artwork-dedup-claims.ts
  - docs/design/artwork-deduplication/04-isolation.md
  - docs/design/artwork-deduplication/phase-3-contracts.md
---

# 作品与来源声明事务基础

> 适用边界（2026-10-24）：本文的根/来源证明、全局 Claim、generation 和有界批量接口继续复用；下文旧 ISOLATE 条件、隔离后释放、恢复与 PURGE 授权不再是目标，不能授权新删除。DIRECT_DELETE 的目的、独立关闭门禁、全范围 fresh 校验及原地 unlink 唯一见[直接删除契约](./direct-delete.md)。第一批收口写入口与双向 release；当前状态以[暂停证据](../../records/artwork-deduplication-resume-pause-2026-10-24.md)为准，不把 WIP 写成完成。

声明基础复用107–110既有表；后续来源证明持久槽使用111迁移，范围见本文末节。模块 `artwork-dedup-claims.ts` 从 DB index 导出基础和有界证明接口，App/Executor 生产接线另行验收；发布门禁仍为3。声明不是文件执行或永久清理授权，调用方仍须完成原计划的版本、内容与整理复核、外部停写确认、执行 drain 和文件协议。

## 锁与公共调用

沿用现有事务：resource/job fence（执行时）→run/operation→本账户审核状态 FOR SHARE→既有 creator catalog（需要维护范围时）→阶段一受信根目录协调→来源行按 identityKey 排序→Artwork ID 升序。不会添加新的全局 advisory lock。根目录协调复用 `lockContentDirectories`，保留与阶段一目录写入声明的互斥；普通文件写者在目录锁后调用来源检查，必须先于 Artwork/内容行锁。纯 Artwork Claim 检查本身只取得 Artwork 行锁，但调用方的实际写语句及触发器可能隐含取得 creator catalog；Artwork/Artist 写入和评分触发器等必须先取得既有 catalog，再按根/来源/Artwork 顺序。来源 helper 不反向取得 creator catalog，不能据此推定整个事务无倒序。

- `claimArtworkDedupScope(tx,{execution,expectedVersion})`：execution 沿用 ArtworkDedupOperationExecution，返回 `{operationId,executionVersion,claimedArtworks,sourceBindings}`（后两项为 bigint 计数）。只接受当前 ISOLATE/ISOLATING 操作、完全准备的清单及备份/外部停写/必要整理确认；调用方仍须持有 runtime fence。固定整个 OperationArtwork 范围，同时认领保留者与副本；任一作品属于其他操作、既有内容写声明未结束、来源被 HOLD/TOMBSTONE 阻断则整事务回滚。源身份从冻结文件/作品来源派生，不接受客户端任意路径。已有同操作同版本声明可重放；改 executionVersion 需要领域重试重新核验后显式迁移声明，不自动接管。
- `assertArtworkDedupWritable(tx,{artworkId,kind})`：kind 为 READING/ORGANIZATION/STRUCTURE/CONTENT/DELETE。READING 允许被声明的 KEEPER；COPY 的阅读以及所有声明作品的其他写入拒绝。该调用必须与实际写入共用事务。
- `captureArtworkDedupSourceGeneration(tx,{identity})` 与 `assertArtworkDedupSourcePublication(tx,{identity,expectedGeneration})`：前者仅在 OPEN 时返回来源ID/代次，后者在同一发布事务内重新锁定来源与根协调、核对 OPEN 及原代次。即使实际 Artwork 尚未创建，也不能绕过来源抑制。
- 生产来源证明使用 `captureArtworkDedupSources(tx,{identities})` / `assertArtworkDedupSources(tx,{sources})`。精确有界接口和锁顺序见下一节；不能用循环调用单身份 helper 代替。
- `artworkDedupUrlHoldPredicate(artworkIdSql)` / `assertNoArtworkDedupUrlHold(tx,{artworkId})`：普通回收、恢复、到期物化、已排队任务和最终删除使用同一持久判定。它不依赖 purgeAfter 或声明过期时间；本 helper 不提供跳过 hold 的布尔参数。
- 本批基础未提供完整释放 helper。新直接删除的取消/终结释放须证明真实退出、持久动作终态、所需完整回执及原 operation/version CAS；部分失败继续保留必要 keeper/copy 声明。来源变回 OPEN 必须推进双向重叠 generation。失败、reader 未退出或不确定文件位置均不能释放，本批不能以 SQL 捷径代替该协议。

## 来源与容量边界

身份仅有 PROVIDER(providerKey,externalId)、PATH(logicalRoot,rootIdentity,canonicalPath)、DIRECTORY(logicalRoot,rootIdentity,canonicalPath)。identityKey 用严格字段序列的 JSON SHA-256，数据库派生与普通发布使用同一编码。路径使用现有规范相对路径规则，按完整目录段比较重叠，`a` 不覆盖 `ab`。来源记录不随 Artwork 删除，根身份变化不解除旧 HOLD/TOMBSTONE。

维护声明从数据库集合派生所有文件路径、URL/Pixiv稳定 provider/externalId，以及 LOCAL_DIRECTORY 的已冻结 storagePath；keeper/copy 都绑定短期来源保护。PREPARE 对独占目录、文件角色、共享引用的核验仍是前置，本模块不将来源声明伪装成归属证明。

URL hold 由未终结的 COPY 声明、持久隔离/恢复/清理状态或尚未归位/删除的文件意图判定。超过普通保留期限仍保留，恢复只能进入去重领域状态机。本批不实现 URL 下载 drain、purge 专属授权、tombstone 解除或实际文件动作。

## 本批精确接口与接入边界

`ArtworkDedupSourceIdentityInput` 为严格字段联合：`{kind:'PROVIDER',providerKey,externalId}` 或 `{kind:'PATH'|'DIRECTORY',logicalRoot,rootIdentity,canonicalPath}`；逻辑根使用阶段一的两种固定值，路径沿用规范相对路径校验。capture 返回 `{sourceId:string,generation:bigint}`；publication 接同一 identity 与 expectedGeneration，成功返回同样投影，非 OPEN 或代次不等抛领域错误。identityKey 由数据库统一对 `[1,kind,logicalRoot,rootIdentity,canonicalPath,providerKey,externalId]` 的 jsonb 文本做 SHA-256，空位为 null。

`assertArtworkDedupWritable(tx,{artworkId,kind})` 成功返回 void；未知 Artwork 拒绝，Claim 存在且不是 KEEPER/READING 时抛 ARTWORK_CLAIMED。`assertNoArtworkDedupUrlHold` 同事务锁 Artwork 后复用 SQL predicate；返回 void，持久 hold 抛 URL_HELD。predicate 接 Prisma.Sql 作品ID表达式，不接原始客户端字符串。

`assertArtworkDedupPathWritable(tx,{directory,scope})` 使用已有 MediaContentDirectoryKey/MediaContentWriteScope，取得同一根协调再核对 PATH/目录上下级来源 HOLD/TOMBSTONE；不创建来源行。`beginMediaContentPathWrite` 在已有根锁后调用它，把 SOURCE_HELD 转成原 WRITING；`beginMediaContentSourceWrite` 在既有 Artwork 升序锁后查 Claim，沿原 WRITING 语义拒绝。两个原语不反向取得 operation、catalog 或来源行锁，不形成循环模块依赖。声明方根锁后检查 ACTIVE/READY/RECOVERY_REQUIRED 写声明，Artwork 锁后检查现有内容写 token；因此先写后认领与先认领后写都串行拒绝。

来源 capture/publication 仅在取得来源锁后检查 OPEN/代次，路径来源先取受信根协调。需要同时发布路径及 provider 的调用方使用下述有界接口，先取得所有根协调，再按 identityKey 顺序检查来源，最后锁 Artwork；不能在 Artwork 锁后反向调用路径来源 helper。本批只提供原语和测试，不宣称其已覆盖全 App/扫描/归档发布入口。

### 有界来源证明接口

以下为本次生产接线使用的 DB 接口，类型直接由 DB 导出，不依赖 job-contracts：

```ts
type ArtworkDedupCapturedSource = {
  identity: ArtworkDedupSourceIdentityInput
  sourceId: string
  generation: bigint
}
captureArtworkDedupSources(tx, { identities: readonly ArtworkDedupSourceIdentityInput[] }): Promise<ArtworkDedupCapturedSource[]>
assertArtworkDedupSources(tx, { sources: readonly ArtworkDedupCapturedSource[] }): Promise<void>
captureArtworkDedupSourceGroups(tx, { groups: readonly (readonly ArtworkDedupSourceIdentityInput[])[] }): Promise<ArtworkDedupCapturedSource[][]>
assertArtworkDedupSourceGroups(tx, { groups: readonly (readonly ArtworkDedupCapturedSource[])[] }): Promise<void>
```

每次调用必须包含一个业务输入的全部一至两项身份；空数组、超过两项、重复身份、重复 sourceId、非规范身份和非 bigint / 越界代次均拒绝。capture 返回与输入顺序相同的证明，身份不做 trim、路径改写或推断。调用方负责在 JSON 边界使用 job-contracts 的严格 version 1 parse/serialize，并把已解析的规范 generation 字符串转回 bigint；DB 不新增依赖环或第二套身份 hash。

DB 先用既有 jsonb SHA-256 编码计算全部身份键并检测重复，随后一次取得全部根协调，在同一根保护内检查路径重叠 HOLD/TOMBSTONE，再按数据库 `identityKey COLLATE "C"` 顺序创建（仅 capture）及锁定来源行。调用方只能在此后取得 Artwork/内容行锁。assert 只读取已存在来源，不为缺失证明创建行；身份键对应的实际行必须仍是原 sourceId，且完整身份字段匹配，否则抛 `SOURCE_IDENTITY_CHANGED`；非 OPEN 或 ownerOperationId 非空抛 `SOURCE_HELD`；代次不等抛 `SOURCE_GENERATION_CHANGED`。拒绝必须使整个业务事务回滚，不得捕获后继续提交。

路径重叠使用三条数据库集合判定：完整 `(logicalRoot,rootIdentity,canonicalPath)` 精确匹配；输入路径的完整目录段祖先与被持有 DIRECTORY 等值匹配；被持有 PATH/DIRECTORY 的完整目录段祖先与输入 DIRECTORY 等值匹配。祖先集合先在数据库内物化，防止优化器把路径展开重排到仅按根联接之后；只有输入包含 DIRECTORY 才展开第三条的被持有路径祖先。祖先含路径自身与空根，深度沿用规范路径的64段上限；相邻段、其他逻辑根或根身份不相交。不得退回仅按根联接后过滤输入×既存来源组合，也不逐输入执行 SQL 或把既存来源全量加载到 JavaScript。继续使用既有来源索引，不新增 hash、索引或锁类别。

页/提交组接口接受一至10000组，每组仍为一个业务输入的一至两项；上限沿用既有冻结输入预算，不读取全媒体集合。跨组共享身份允许并只锁一次，组内重复仍拒绝；返回保持两层输入顺序。单输入接口包装同一核心。JSON recordset 集合查询统一计算身份键，全部根协调后对全集去重、排序取得来源锁，不为每行循环执行 SQL。现有新意图、冻结页和入队继续共用原 fence 事务；同一事务应一次传入完整 groups，不可循环调用单输入/单组接口，也不可在 Artwork 锁后调用。任一组证明失配使整页事务回滚。旧单身份 helper 仅保留兼容既有基础测试，不可用于持久来源证明的生产发布。此接口不实现 release、drain、代次传播或任何文件动作，发布门禁仍为3。

认领保持原 operation version，不递增以便同版本幂等重放；同操作不同 executionVersion 的已有 Claim 拒绝，不能自动接管。来源先由冻结文件、LOCAL_DIRECTORY 的冻结 storagePath、登记外部来源及 PIXIV_SCAN externalId 派生，再核对完整快照；失败必须向外抛出使整事务回滚，不得捕获后提交部分认领。来源按固定身份集合写入与绑定，绝不把全清单加载到 JavaScript。

## 目录释放的后续集成门槛

本批没有 release。未来 DIRECTORY 从 HOLD/TOMBSTONE 获准转回 OPEN 时，必须持有既有根协调锁，对完整目录段覆盖的所有既存 PATH/DIRECTORY 来源一并递增 generation，并与该来源状态释放原子提交；不能仅递增目录自身而允许此前捕获子 PATH generation 的旧任务发布。新的来源捕获和发布沿同一根锁串行，因此不能在传播期间取得半释放状态。单 PATH 的释放仍推进自身代次。重叠的其他操作 HOLD/TOMBSTONE 不得被此释放清除。

上述传播及真实旧任务拒绝测试是后续 release/发布开放门槛，不属于本批已验证行为；现有单身份 publication 检查不能单独称为覆盖完整目录释放周期。沿用同一 generation 模型，不新增祖先快照版本体系。

## 持久来源证明与入口接线

本节为已确认的接线基线；111持久槽、格式契约和 DB 有界来源接口已实施，生产入口接线待各批汇总验收；不改变 gate 3。具体调用位置和静态证据见[写入口盘点](../../records/artwork-deduplication-write-entry-map-2026-10-24.md)。

### 字段与固定证明

在以下五张既有业务表各新增 `dedupSourceSnapshot Json?`：

| 表                    | 保存时机                                          | 证明身份                                   |
| --------------------- | ------------------------------------------------- | ------------------------------------------ |
| ScanRunMetadataInput  | 读前捕获，冻结事务核验保存；已冻结行复用          | Pixiv PROVIDER 与精确元数据 PATH，最多两项 |
| ScanRunLocalWorkInput | 目录导入/重扫输入冻结事务内捕获                   | 已确认的 LOCAL_DIRECTORY DIRECTORY，一项   |
| PixivSourceAuditItem  | 从产生观察的冻结输入复制                          | 原输入证明，Apply 继续原样传递             |
| ArchiveIntakeItem     | 新提交意图与 RESOLVE 入队的同一事务内捕获         | URL 的 PROVIDER，一项                      |
| ArchiveImport         | READY Intake 经复核转为 DOWNLOAD 的同一事务内复制 | Intake 原证明                              |

共享严格 Zod 结构为 `{version:1,sources:[{identity,sourceId,generation}]}`。sources 为一至两项，不重复身份；generation 使用规范无符号十进制字符串，不经 JavaScript number。identity 采用本文件同一严格联合及身份编码，sourceId 为 capture 返回的来源 ID。断言须核对原 identity、sourceId、generation，不能由调用者凭文件名推断身份或另写一套 hash。不得把证明塞入 metadata hash、resolvedSnapshot、rawMetadata 或 staging generationToken。

URL provider 新增服务端纯身份解析能力，使用现有受信 URL 解析规则；在产生执行意图前提取 provider/externalId，最终 network resolve 的身份必须与其相同。当前 E-Hentai /g 与 /s 均含 gid，不能以取得网络 token 为由推迟到 resolve 完成后才捕获。未知/不能纯解析的身份不得排入可写执行链。

capture/publication 的有界批量包装须复用 DB 身份编码与既有锁：先全部根协调，再来源 identityKey 排序，再 Artwork。单输入至多两项；输入页沿原有分页预算冻结，不增加全文件 JSON。Pixiv provider 保护不意味着拥有平铺父目录；只有已确认 LOCAL_DIRECTORY 可使用目录证明。仅具 PATH 身份的历史非 LOCAL_DIRECTORY 不可换成父目录证明，尚未固定精确证明的分支拒绝执行。

### 扫描页与审计交接

发现新候选时，在读取 metadata 内容及形成 hash/分类之前捕获该页证明；原 fenced 页提交事务核验所有候选的原证明，再持久化 changed 输入、inventory 和计数。unchanged 页即使产生零输入，也须在更新 lastSeen、inventory 或检查点前核验。CLIENT_LIST 与本地导入仍在原 afterEnqueue 事务捕获并冻结。

已经落盘的输入，即使 run.inputFrozenAt 尚为空，也只能匹配并复用原路径、序号、hash、属性及来源证明，不能删除重建或换代。若一页尚未提交任何输入便中断，允许重新发现，但必须丢弃该页旧读取/分类结果，在新捕获后重新读取；不能将旧 hash 或观测拼接到新证明。PROCESS_STORED_HASH 候选同样重新读取内容。

审计观察复制冻结输入证明。App Apply 校验观察与原输入的证明一致并原样转发，可创建待执行意图；它不捕获新代次，也不将排队成功视为当前来源可写。Executor 在实际读取和最终发布前核验原证明；来源已 HOLD 或换代则拒绝执行。MISSING 观察没有输入证明时仅报告，不补造证明。

### 存量、重试和允许的控制回执

nullable 只兼容迁移存量。旧未完成 SCAN 输入、已排队或 READY Intake、ArchiveImport 遇 null/缺失/未知版本/格式错误，进入需人工处理的拒绝路径；不能在执行、恢复、重试、phase handoff 或最终发布时补捕获当前代次，也不能默认 0。迁移不从当前数据库或文件状态推导历史代次。

显式新意图须重新核验身份并冻结新的证明，同时保留原任务与检查点；不能通过更新原输入来解除旧代次限制。旧审计可展示，缺证明差异不能 Apply。已完成任务仅允许真正无领域写入的幂等读取；会更新 lastSeen、媒体或来源的 SKIP 仍是写入。

来源 HOLD 或证明缺失时，允许既有运行时的租约/控制处理，以及原执行的取消、失败、停止/drain 回执；它们必须继续受原 job/execution fence 和 token 约束。不得让 OPEN 检查阻止已退出执行者提交 drainedAt。此允许列表不授权新的网络媒体单元、媒体成功收据、来源重绑定、正式发布、普通恢复/清理或重新捕获代次。

### staging 登记与 drain

归档执行开始必须先在原 fence 与来源锁内登记本次 ArchiveStagingGeneration，再执行首次 staging 文件动作；generationToken 仍是执行身份，来源证明保持原 Import 值。先 mkdir 再登记的启动窗口必须关闭，复用现有 generation 表，不另建执行框架。

去重 HOLD 建立后请求既有下载取消/abort 控制，事务外等待并让出 BACKGROUND_WRITER。drain 必须检查同 provider/externalId 的全部活动 Import/ImportExecution 与尚无真实退出证明的 generation，包含旧执行 token、失租约以及迁移前已启动但没有 generation 行的执行。等待只返回有界聚合与阻断原因。

只有原执行所有媒体操作 settled、资源关闭后，以原 token 持久 drainedAt 才是正常退出证明。cancel 请求、FAILED、lease 过期或发送 abort 均不能替代。不能提交退出回执的 orphan 保持需人工处理，不清 token 或伪造 drain。原媒体动作前再次检查 drain；旧执行迟到发布必须由原来源代次及 HOLD 拒绝。

普通 URL trash/restore/purge、RECONCILE 物化和 staging cleanup 在请求、实际执行前、最终事务调用相同持久 hold 规则；超过七天或已有排队任务没有例外。领域中的完整恢复/永久清理仍须专用操作授权，普通接口不接管。

### 双向重叠释放验收门槛

目录释放向下传播是必要条件，还必须覆盖旧 DIRECTORY 证明跨其子 PATH 的 HOLD→OPEN 周期。未来任一 PATH/DIRECTORY 来源释放，在既有根锁下使所有受该周期影响的既存重叠 PATH/DIRECTORY 证明失效：PATH 至少推进自身及覆盖它的既存 DIRECTORY；DIRECTORY 推进自身、覆盖范围内 PATH/DIRECTORY 及覆盖它的既存 DIRECTORY。状态释放与代次推进原子提交，不能解除其他操作的 HOLD/TOMBSTONE，也不另加祖先快照版本体系。

开放 release 前必须真实验证两个方向：旧 PATH 跨祖先 DIRECTORY 周期后拒绝；旧 DIRECTORY 跨子 PATH 周期后拒绝。还须验证相邻路径段不误认重叠，以及传播期间 capture/publication 与根锁串行。本节没有实现 release，现有单 identity helper 测试不构成上述整周期证明。

## 来源证明槽小批的实际导出

正式迁移111为上述五表添加 nullable JSONB，无默认或回填；旧值仍是无证明。当前仅完成持久槽与共享格式，不代表扫描、Intake、Import 或审计执行入口已经验证该字段。

job-contracts 的 artwork-dedup-source-snapshot.ts 导出 artworkDedupSourceIdentitySchema / ArtworkDedupSourceIdentity、artworkDedupSourceSnapshotSchema / ArtworkDedupSourceSnapshot、parseArtworkDedupSourceSnapshot(value:unknown) 和 serializeArtworkDedupSourceSnapshot(sources)。serialize 接受一至两项 {identity,sourceId,generation:bigint}，只把 bigint 转规范十进制；parse 对 null、缺失、未知版本、未知字段、重复 identity/sourceId 及越界值报错，无默认0、trim或代次强制转换。generation 范围0至PostgreSQL signed bigint最大值。

身份字段和规范路径规则对应现有 DB 联合；身份摘要仍只由 DB 的统一 jsonb SHA-256 编码负责，契约模块不生成第二套 hash。格式解析不证明 sourceId 属于该 identity，也不证明 OPEN、当前generation或调用者权限；生产捕获/发布必须后续在既定锁序与原 fence 中核验这些事实。

新冻结或从原输入复制时通过 Prisma create 的字段保存已校验对象。不提供对旧行 null 补当前证明的通用 updater，不把同一输入的更新当新意图；DB 有界批量 capture/assert 已在上文固定，实际生产入口接线另行验收。证明不加入任何客户端 mutation 或通用 job payload。


## 第一批补充：原子释放与归档排空原语

`reopenArtworkDedupSources(tx,{operationId,sources})` 是内部来源状态原语，sourceId/expectedGeneration 必须来自服务端持久范围；调用者先持有原 operation/version/fence，核实可释放的生命周期、真实退出和文件回执。它本身不取消操作、不删除 Claim、不授权重新导入，也不接入 App。按既有根协调、identityKey 顺序锁定选中及双向重叠来源，一次推进受影响 generation，只将指定 owner 的选中 HOLD/TOMBSTONE 变 OPEN；其他 owner 的状态和归属保持不变。下一批取消/终结/allowReimport 在原子事务内接入，未知执行或未决文件意图不得调用。

归档排空以所有历史 ImportExecution 的 job attempt 和所有 StagingGeneration 为范围，不能只看 Import 当前 token。已开始但缺登记的尝试、无 drainedAt 的任何 token、仍活动的执行和未结束内容声明均阻断。最小查询原语只报告具体阻断/需停止的 job，不把任务终态当退出。下一批认领之后使用原任务控制协议发停止请求，持久等待并让出 Writer，再重新查询；本批不新造取消协议或离线确认。旧无登记执行必须由独立既有恢复证据处理，不能在线补 drainedAt。
