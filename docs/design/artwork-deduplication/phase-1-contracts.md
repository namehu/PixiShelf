---
status: draft
scope: 去重第一阶段六张核心表、独立恢复授权表、共享数据库接口、媒体根命名空间及声明持有者发布契约
last-verified: 2026-10-23
sources:
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-db/src/artwork-reading.ts
  - packages/pixishelf-job-runtime/src/queue-repository.ts
  - packages/pixishelf-job-executors/src/scan/root-identity.ts
  - packages/pixishelf-job-executors/src/scan/paths.ts
  - packages/pixishelf-worker/src/config.ts
  - packages/pixishelf/services/setting.service.ts
  - packages/pixishelf/services/archive/config.ts
  - packages/pixishelf/services/artwork-service/media-upload.ts
---

# 第一阶段共享技术契约

本文冻结供 DB、Executor 与 App 实施的接口，尚不表示代码已实现。业务定义、阶段门槛和交付证据以[总计划](../artwork-deduplication.md)为准；一致性要求及验收案例以[第一阶段规格](./01-fingerprints.md)为准。本文只维护精确类型、数据含义及调用顺序。

DB 包拥有下列类型、纯校验和短事务操作，计划从 `@pixishelf/db` 导出。文件系统解析和读取归共享 Executor 模块；App 使用专用源代码子路径导出，不依赖整个 Executor 包的预构建 dist。DB 接口不读取文件、不开启嵌套事务，也不依赖 Next.js 或 job-runtime。

## 根命名空间与规范路径

当前 App 的扫描根来自 `Setting.scanPath`，Worker 来自 `SOURCE_MEDIA_ROOT` / `SCAN_PATH`；归档根分别来自 `ARCHIVE_STORAGE_PATH` 与 `ARCHIVE_ROOT` / `ARCHIVE_STORAGE_PATH`。这些配置必须经过同一共享解析器，不能各自把原始配置字符串 hash 成独立 gate key。

固定命名空间只有 `source-media:v1` 和 `archive-media:v1`：

1. source 根及其所有子目录使用 `source-media:v1`，与 Pixiv、Local、Archive 等 provider 无关。
2. archive 根等于或位于 source 根内部时，归档也使用 `source-media:v1`，规范路径相对 source 根计算，包括嵌套目录前缀。同一实际文件不得出现两套声明。
3. 两根确实不相交时才使用 `archive-media:v1`；source 根反向嵌套于 archive 根、符号链接别名、根身份不一致或无法确定映射时拒绝并返回 `ROOT_CHANGED` / 路径错误，不另建 namespace 回避旧声明。
4. 目录唯一键为 `(logicalRoot, relativeDirectory)`；根身份是此键绑定的值，不是唯一键的一部分。根变化不能绕过先前未结束的写入声明。

`relativeDirectory` 和文件路径是 canonical POSIX 相对路径：不含开头/末尾 `/`、反斜线、空段、`.`、`..`、NUL 或盘符；根目录唯一表示为 `''`。不做大小写折叠或 Unicode 重编码。已有以 `/` 开头的 Image 路径由服务端适配器解析，DB CAS 同时保存并比较原始 `sourcePath`，不把用户提供路径直接当 canonical path。

```ts
type MediaContentLogicalRoot = 'source-media:v1' | 'archive-media:v1'

interface MediaContentRootBinding {
  logicalRoot: MediaContentLogicalRoot
  rootIdentity: string
}

interface ResolvedMediaContentRoot extends MediaContentRootBinding {
  absolutePath: string // 只在服务器内部使用
  deviceId: bigint
  inode: bigint
}

// 归属共享 Executor 模块；所有 FS I/O 均在数据库事务之外。
resolveMediaContentRoots(input: {
  sourceRoot: string
  archiveRoot: string
  expectedPixivRootIdentity: string | null // 从现有 inventory 读取
}): Promise<{
  source: ResolvedMediaContentRoot
  archive: ResolvedMediaContentRoot
  archiveRelativePrefix: string // 两根合并时相对 source 的目录，否则 ''
}>
```

共享解析器只读验证 `.pixishelf-root`，不调用可能创建 marker 的 `bindPixivInventoryRoot`。已有 marker 使用小写 UUID，且必须与已绑定 inventory 相符；已绑定却缺失/冲突时失败。非 Pixiv 根在无既有 marker 时使用受信配置与本次根身份。`rootIdentity` 是版本化、长度编码的根类型、已有 marker UUID（或显式 configured 类型）、规范根路径、`dev`、`inode` 的 SHA-256；整数用十进制字符串。不能只使用现有 `hashScanRootIdentity(absolutePath)`，也不能把根目录 mtime/ctime 放入身份导致每次新增文件换根。

App/Worker 必须对同一 namespace 得到相同绑定。路径别名或挂载差异导致无法证明一致时失败关闭；不静默降级为其他根。后续 root identity 改变使已有缓存不可复用，须结束本次读取并沿既有根核对流程处理；本文不增加自动根确认、自动 marker 创建或自动解除声明。

## 六张表及约束

下表为拟新增模型。源表与缓存表分开，缺少缓存不意味着可以绕过写入状态。迁移只创建结构与触发器，不扫描媒体、不回填哈希。

| 模型                         | 主键/关系                                        | 必须保存的字段与含义                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MediaContentDirectoryState` | 独立 ID；`(logicalRoot, relativeDirectory)` 唯一 | `rootIdentity`、`generation BigInt`、时间。无 Artwork/Image FK；仍有声明时不得删除。                                                                                                                                                                                                                                                     |
| `MediaContentPathWrite`      | 独立 ID；目录 FK；可空 `parentWriteId` 自关联    | `scope PATH/DIRECTORY`、canonical 路径、`sessionId`、`ownerUserId`、`sessionVersion BigInt`、`writeToken`、`declarationVersion BigInt`、可空 job/execution token/attempt、状态、开始/完成时间。上传还保存下述逐文件 checkpoint/回执，以及可空 childDisposition/resolutionEvidenceId/resolvedAt。不能随 Image/Artwork/User 删除级联消失。 |
| `MediaContentSource`         | `imageId` PK/FK，随 Image 删除                   | `revision BigInt`、可空 `directoryStateId`、`writeToken`、`writeStartedAt`。即使没有 fingerprint 也能阻止发布。                                                                                                                                                                                                                          |
| `ArtworkContentSource`       | `artworkId` PK/FK，随 Artwork 删除               | `revision BigInt`、`mediaEpoch BigInt`、可空 `writeToken`、`writeStartedAt`。revision 覆盖成员与内容变化，epoch 专用于整作写。                                                                                                                                                                                                           |
| `MediaContentFingerprint`    | `imageId` PK/FK，随 Image 删除                   | `algorithmVersion`、`rootIdentity`、原始 `sourcePath`、canonical 路径、`sourceRevision BigInt`、`artworkMediaEpoch BigInt`、文件属性、小写 SHA-256、真实 `hashedAt`。                                                                                                                                                                    |
| `ArtworkContentFingerprint`  | `artworkId` PK/FK，随 Artwork 删除               | `algorithmVersion`、`sourceRevision BigInt`、`mediaEpoch BigInt`、`membersSignature`、`fileCount BigInt`、`contentSha256`、`completedAt`。不存无界 JSON 多重集合。                                                                                                                                                                       |

revision/generation/epoch 初始为 `0n`，只增不减；空源行的读取语义等同 `0n`，首次写入按锁顺序建立。大小与文件属性使用 PostgreSQL BIGINT / TypeScript bigint；大小必须为正，属性缺失是 null。SHA-256 为 64 位小写十六进制；路径、整数与状态有数据库检查约束，跨行的父子范围由锁内 helper 验证。缓存命中不更新 `hashedAt`。

路径声明状态为 `ACTIVE | READY | RECOVERY_REQUIRED | COMPLETED | ROLLED_BACK`。前三者均阻止外部扫描/读取发布；READY 只表示上传完整，未表示 Image 已登记。终态释放唯一的活动路径占用；token 和版本不同的旧请求不能结束新声明。`ownerUserId` 是持久审计标识，由 Session 或持久 job 操作者提供，不作为级联 FK；系统任务允许 null，用户上传必须非空。

DIRECTORY 声明拥有其目录内全部路径。会话内上传以同表 `parentWriteId` 子记录保存逐文件 checkpoint，必须由父 owner 授权；这些记录从属于父声明，不视为外部独立 writer。子记录 READY 不解除父声明。数据库及 helper 禁止其他 owner 在父范围内建立 PATH/DIRECTORY 声明，也禁止通过不同父 ID 绕过冲突。

## 公共类型与失败语义

```ts
type MediaContentTransaction = Prisma.TransactionClient

interface MediaContentDirectoryKey extends MediaContentRootBinding {
  relativeDirectory: string
}

interface MediaContentDirectorySnapshot extends MediaContentDirectoryKey {
  directoryId: string
  generation: bigint
}

interface ArtworkContentSnapshot {
  artworkId: number
  revision: bigint
  mediaEpoch: bigint
  memberCount: bigint
}

interface MediaContentFileState {
  size: bigint
  mtimeNs: bigint | null
  ctimeNs: bigint | null
  deviceId: bigint | null
  inode: bigint | null
}

interface MediaContentFileFingerprint extends MediaContentFileState {
  imageId: number
  algorithmVersion: number
  rootIdentity: string
  sourcePath: string
  canonicalPath: string
  sourceRevision: bigint
  artworkMediaEpoch: bigint
  sha256: string
  hashedAt: Date
}

interface MediaContentMember {
  imageId: number
  artworkId: number
  sourcePath: string
  sourceRevision: bigint
  writeToken: string | null
  directory: MediaContentDirectorySnapshot | null
  fingerprint: MediaContentFileFingerprint | null
}

type MediaContentRejection = {
  status: 'MISSING' | 'STALE' | 'WRITING' | 'ROOT_CHANGED' | 'INCOMPLETE'
}

type MediaContentResult<T> = { status: 'READY'; value: T } | MediaContentRejection
```

无效参数、越界页大小、重复 ID/重复目录、非法 bigint/摘要直接抛出参数错误。上述 rejection 表示零发布，不退化为无条件 upsert。`55P03`、`40P01`、`40001`、Prisma `P2034` 是可重试的整个短事务失败，不在已失败事务中捕获后继续；文件写入不得随数据库重试重复执行。

## 读取、观察与指纹发布

所有 `tx` 由调用方提供。Worker 的修改调用放入现有 `context.mutateInTransaction`，在事务开始与提交边界验证执行围栏；DB 接口不自造可伪造的 `fenceValid: true` 参数。

```ts
captureMediaContentDirectory(tx, input: {
  directory: MediaContentDirectoryKey
}): Promise<MediaContentResult<MediaContentDirectorySnapshot>>

assertMediaContentDirectorySnapshot(tx, input: {
  snapshot: MediaContentDirectorySnapshot
}): Promise<MediaContentResult<MediaContentDirectorySnapshot>>

captureArtworkContentSnapshot(tx, input: {
  artworkId: number
}): Promise<MediaContentResult<ArtworkContentSnapshot>>

readArtworkContentMembersPage(tx, input: {
  snapshot: ArtworkContentSnapshot
  afterImageId: number | null
  limit: number // 1..500
}): Promise<MediaContentResult<{
  members: MediaContentMember[]
  nextCursor: number | null
}>>

bindMediaContentDirectories(tx, input: {
  snapshot: ArtworkContentSnapshot
  bindings: Array<{ // 1..100；文件读取前调用
    imageId: number
    expectedSourcePath: string
    expectedSourceRevision: bigint
    directory: MediaContentDirectorySnapshot
  }>
}): Promise<MediaContentResult<ArtworkContentSnapshot>>

interface MediaContentObservation {
  imageId: number
  expectedSourcePath: string
  expectedSourceRevision: bigint
  directory: MediaContentDirectorySnapshot
  canonicalPath: string
  state: MediaContentFileState
  sha256?: string // 完整重读发现保持属性的内容变化时提供
}

observeMediaContentSources(tx, input: {
  snapshot: ArtworkContentSnapshot
  observations: MediaContentObservation[] // 1..100
}): Promise<MediaContentResult<{
  changed: boolean
  snapshot: ArtworkContentSnapshot
  changedSources: Array<{ imageId: number; sourceRevision: bigint }>
}>>

interface MediaContentReadEvidence extends MediaContentObservation {
  sha256: string
  hashedAt: Date
}

publishMediaContentFingerprints(tx, input: {
  snapshot: ArtworkContentSnapshot
  algorithmVersion: number
  entries: MediaContentReadEvidence[] // 1..100；只提交真实新读取
}): Promise<MediaContentResult<{ count: number }> | {
  status: 'OBSERVATION_REQUIRED'
}>

interface MediaContentFingerprintCursor {
  size: bigint
  sha256: string
  imageId: number
}

readArtworkContentFingerprintPage(tx, input: {
  snapshot: ArtworkContentSnapshot
  algorithmVersion: number
  after: MediaContentFingerprintCursor | null
  limit: number // 1..500
}): Promise<MediaContentResult<{
  entries: Array<{ imageId: number; size: bigint; sha256: string }>
  nextCursor: MediaContentFingerprintCursor | null
}>>

publishArtworkContentFingerprint(tx, input: {
  snapshot: ArtworkContentSnapshot
  algorithmVersion: number
  membersSignature: string
  contentSha256: string
  completedAt: Date
}): Promise<MediaContentResult<{ artworkId: number }>>
```

成员页按 Image ID 升序；内容页按大小整数升序、32 字节 SHA-256 升序、Image ID 升序。数据库摘要排序使用固定字节/C collation，不能随 locale 改变。重复 tuple 逐项保留。两个流式编码器的域与长度编码由 Executor 定义同一算法版本；作品发布不接收完整成员数组或多重集合数组。

作品快照只冻结版本、epoch、数量。新绑定前先检查目录 generation/无 writer；绑定完成后才允许文件 I/O。首次无旧缓存绑定不增加媒体代次，已有根/路径绑定变更必须先 observe，不静默重绑。任何目录 generation 变化，同事务批量推进该目录已绑定媒体所属作品 revision，不推进未改变媒体的 revision。已读取目录之后发生写入，会使整个作品快照过期；尚未绑定目录有活动写入时不能开始读取。这支持多目录作品而不把全部目录装入一个快照。

observe 在 CAS 后使变化媒体及其作品代次递增、旧缓存失效，明确返回新快照。调用方清空该作品的流式聚合并重新分页；可按返回的新媒体代次保留已验证的刚完成读取。首次无缓存不因观察本身增代次。publish 遇到与有效旧缓存不一致的根/路径/属性/SHA 返回 `OBSERVATION_REQUIRED`，不隐式换版本。单图变化不删除其他文件缓存；整作 epoch 变化使全部旧 epoch 缓存不可用。

每页与每批提交校验同一作品版本。文件提交另查该批完整成员身份、路径、源代次、epoch 和目录快照。最终作品发布在锁下聚合核验非零成员数量、全局版本、每个成员的当前绑定/算法/源代次/epoch、有效正大小摘要及无活动 writer；缺一项返回 INCOMPLETE/STALE。只检查聚合数量不够，不能把不存在 source 行或未绑定目录的成员当作已完成。

## 写声明、分块回执与 owner 发布

```ts
type MediaContentOwner = {
  ownerUserId: string | null
  sessionId: string // 稳定上传/替换/维护业务 ID，不随 HTTP 重试新建
  sessionVersion: bigint
  execution: null | {
    jobId: string
    executionToken: string
    executionAttempt: number
  }
}

type MediaContentWriteScope =
  | { kind: 'PATH'; relativePath: string }
  | { kind: 'DIRECTORY' }

interface MediaContentWriteHandle {
  writeId: string
  directoryId: string
  writeToken: string
  declarationVersion: bigint
  scope: MediaContentWriteScope
  parentWriteId: string | null
}

interface MediaContentChunkReceipt {
  requestId: string // 客户端为一次块请求生成，重试必须保持
  chunkIndex: number
  offset: bigint
  byteLength: bigint
  sha256: string
}

interface MediaContentUploadCheckpoint {
  handle: MediaContentWriteHandle
  status: 'ACTIVE' | 'READY' | 'RECOVERY_REQUIRED' | 'COMPLETED' | 'ROLLED_BACK'
  declaredFileSize: bigint
  totalChunks: number
  nextChunkIndex: number
  committedBytes: bigint
  lastReceipt: MediaContentChunkReceipt | null
}

beginMediaContentPathWrite(tx, input: {
  directory: MediaContentDirectoryKey
  scope: MediaContentWriteScope
  owner: MediaContentOwner
  writeToken: string
  upload: null | { declaredFileSize: bigint; totalChunks: number }
  parent: MediaContentWriteHandle | null
  now: Date
}): Promise<MediaContentResult<MediaContentWriteHandle>>

getMediaContentUploadCheckpoint(tx, input: {
  owner: MediaContentOwner
  writeId: string
  writeToken: string
}): Promise<MediaContentResult<MediaContentUploadCheckpoint>>

prepareMediaContentUploadChunk(tx, input: {
  owner: MediaContentOwner
  handle: MediaContentWriteHandle
  declaredFileSize: bigint
  totalChunks: number
  requestId: string
  chunkIndex: number
  offset: bigint
  observedFileSize: bigint | null // 持 FS 锁检查；新路径允许 null
}): Promise<MediaContentResult<{
  action: 'WRITE' | 'REPLAY'
  checkpoint: MediaContentUploadCheckpoint
}>>

ackMediaContentUploadChunk(tx, input: {
  owner: MediaContentOwner
  handle: MediaContentWriteHandle
  receipt: MediaContentChunkReceipt
  verifiedFileSize: bigint
  now: Date
}): Promise<MediaContentResult<MediaContentUploadCheckpoint>>

markMediaContentWriteRecoveryRequired(tx, input: {
  owner: MediaContentOwner
  handle: MediaContentWriteHandle
  failureCode: string
  now: Date
}): Promise<MediaContentResult<MediaContentWriteHandle>>

resolveMediaContentChildWrites(tx, input: {
  owner: MediaContentOwner
  parent: MediaContentWriteHandle
  children: Array<{ // 1..100；持久记录每个 child 的处置结果
    handle: MediaContentWriteHandle
    resolution:
      | { kind: 'PUBLISH'; receipt: MediaContentChunkReceipt }
      | {
          kind: 'VERIFIED_ROLLBACK'
          disposition: 'RESTORED' | 'REMOVED' | 'ISOLATED'
          evidenceId: string // 服务端已有 manifest/恢复证据标识，不接受任意客户端路径
        }
  }>
  now: Date
}): Promise<MediaContentResult<{ children: MediaContentWriteHandle[] }>>

assertMediaContentOwnerPublication(tx, input: {
  owner: MediaContentOwner
  handles: MediaContentWriteHandle[] // 1..100；只验证，不结束声明
}): Promise<void>

withMediaContentOwnerPublication<T>(tx, input: {
  owner: MediaContentOwner
  handles: MediaContentWriteHandle[] // 1..100 顶层声明，不把全部子文件放入参数
  outcome: 'committed' | 'verified-rollback'
  now: Date
}, publish: (tx: MediaContentTransaction) => Promise<T>): Promise<{
  result: T
  finishedWriteIds: string[]
}>
```

begin 只创建新的声明，不把同路径现有 token 交给新调用方。用户上传 ownerUserId 必须取 Session；begin 的重复 session/token 可返回已存在同声明的句柄，但不能重置 checkpoint，也不授权重新写首块。续传只走 prepare：核对 owner、token、session/execution 版本、声明范围、原始 declaredFileSize/totalChunks，以及 nextChunkIndex/committedBytes。所有块写入仍由现有 FS 目录锁串行，锁在 prepare 前取得、ack 后释放。

逐文件上传字段使用独立类型列；lastReceipt 含 requestId、chunkIndex、offset、byteLength、sha256，不把 bigint 存为浮点 JSON。只有已关闭写句柄、校验实际长度及块摘要后才能 ack；需要稳定落盘的既有写协议仍在 ack 前完成。ack CAS 推进 declarationVersion/nextChunkIndex/committedBytes；最后一块还要求总块数及总大小完全匹配，再进入 READY，不能直接结束声明。 App 普通媒体的最后块必须在 ack READY 前完成原有 Sharp 元信息及声明长度校验；校验失败以该块当前 handle CAS 标记 RECOVERY_REQUIRED，保留原账户/session/token/gate。既有 READY 末块重放若发现元信息或长度失败，用返回 checkpoint 的已推进 handle 标记恢复，不能使用旧块版本；COMPLETED 终态不能重新开启。

响应丢失后，最近一次 requestId/index/offset 与持久回执相符时 prepare 返回 REPLAY，不再次打开或改写文件；返回当前 checkpoint。更老的块请求拒绝为 STALE，客户端凭自己的 owner/session/token 读 checkpoint。不能仅按路径取 token、凭文件长度认领他人会话或在未知部分写入后直接跳过字节。文件实际长度与已确认 checkpoint 不符、流异常或结果未知时保留 RECOVERY_REQUIRED；数据库不可用时原活动声明仍阻止发布。

普通新增上传在 READY 后，由 addImage/batchRegisterImages 将所有对应 PATH handles 交给 owner publication。同 ID 覆写也要在 owner publication 中提交元数据与内容失效，之后才结束声明。DIRECTORY 会话内文件使用 parentWriteId 子记录；父 owner 与范围校验通过才能创建/续传，子文件 READY 仍不释放父。

目录提交对**全部已声明 child**逐一形成持久处置：纳入者须 READY 且最终回执匹配，记为 PUBLISH；忽略失败、未完成或未选择者，必须在父 gate 下按服务端登记的精确路径完成并验证恢复原件、移除新文件，或移动到扫描排除的恢复区，再记为 RESTORED/REMOVED/ISOLATED 并保存恢复证据标识。不能先写 VERIFIED_ROLLBACK 再做文件操作，不能接受客户端任意删除路径。resolve 接口逐批 CAS 保存结果，不使用无界 JSON。已验证回滚的 child 可以进入 ROLLED_BACK，但父范围仍保持阻断。

父发布前数据库聚合验证所有 child 均已解决，而非只校验本次选中的成功项；业务回调登记的成员必须恰好对应持久 PUBLISH 集合。任何仍为 ACTIVE/RECOVERY_REQUIRED、无 disposition、回执不匹配或缺少恢复证据的 child 都阻止父完成。检查不能把失败项过滤掉。这样父结束后不会遗留可被下一次扫描重新登记的半文件。未知异常不进入终态。

owner publication 是专用事务包裹器：先取得目录与声明锁，验证精确 token、declarationVersion、owner/sessionVersion、execution 及原始 scope，拒绝其他 owner 的重叠声明；随后执行 publish 回调中的业务 DML，最后 CAS 结束自身声明/已确认子记录、推进目录 generation 并完成源状态失效。验证失败或最终 CAS 失败必须抛错回滚整个事务，不能返回 false 后保留已执行 DML。调用方必须把全部业务 DML 放在回调内，不能先 finish 再另行登记 Image；不提供绕过该包裹器的普通成功 finish API。

既有迁移的 copy → 数据库路径 CAS → 清理旧路径流程，可在中间短事务先调用 `assertMediaContentOwnerPublication` 再执行该步业务 DML；完整 owner/token/scope 检查与 DML 必须共用事务，声明继续保持。最后已经验证旧路径清理完成，再调用包裹器提交最终状态并结束声明；不能为了中间路径 CAS 提前解除声明。

**owner 不比较目录 generation 与 begin 时值。** generation 用于使扫描/读取快照过期；同目录不相交 PATH 可以各自完成。PATH 与相同 canonical 路径冲突，DIRECTORY 与其范围内所有 PATH/子目录范围冲突；目录父声明自己的授权子记录除外。声明范围不能在发布时扩大。Worker owner 还必须处在现有运行时 fence 事务内，数据库中的 execution 字段不能替代租约检查。

verified-rollback 的文件核对必须已在事务外完成并证明旧写入者退出，才可调用相同包裹器修复业务状态并结束声明。普通 prepare 不恢复 RECOVERY_REQUIRED，不存在按时间自动恢复/接管的接口；更换 owner/session/execution 版本只能经既有停写恢复流程的显式 CAS，不能借普通 retry 自动接管。

顶层用户 PATH 的显式“从头重新上传”是另一条受限入口：App 持原声明路径的文件系统锁，确认前写已退出，并以原账户/session/token 和精确 handle 调用下列 helper。只接受 execution=null、parent=null、存在上传 checkpoint 的 RECOVERY_REQUIRED PATH；保留原路径、声明大小、块数与所有 source gate/token，清零块进度/最后回执，恢复 ACTIVE 并推进 declarationVersion。它不声明旧文件内容已恢复，不解除 gate，也不复用先前块；从第 0 块重写，最终业务登记后才结束声明。

```ts
restartMediaContentUploadFromStart(tx, input: {
  owner: MediaContentOwner
  handle: MediaContentWriteHandle
  now: Date
}): Promise<MediaContentResult<MediaContentUploadCheckpoint>>
```

返回的新 handle 是本次 restart 授权。App 必须让 restart 后的所有块携带该版本，不能通过无授权 begin/checkpoint 查询把旧请求升级为当前 handle；旧块 prepare/ack 被版本检查拒绝。DIRECTORY 子上传、Worker execution、终态及 ACTIVE/READY 状态均不走此入口。

既有视频无损重新封装的 finalizer 保留少量同文件系统 rename 与失败 rollback，以维持当前执行围栏和晚到取消协议；持久写入声明必须在进入该 finalizer 及旧产物恢复之前建立。此处不假设文件系统与数据库原子提交，提交失败或恢复不确定时保留声明。哈希、ffprobe、转码和目录遍历仍在事务外，新去重代码不沿用事务内长时间媒体读取。

### 已完成文件发布的归档声明交接

既有归档 `ARCHIVE_PUBLISH` 的崩溃恢复保留一个受限例外：同一发布 job 的新 attempt 可交接已完成文件发布、仅剩业务 DML 的声明。它不是通用 Worker 接管能力；迁移、替换、重新封装以及尚未完成文件发布的归档仍必须保持阻断并走明确的停写恢复流程。

证明边界来自 `archive/storage.ts` 的 `prepareArchiveRevisionDirectory`：唯一内容变更是 staging 到 final 的同文件系统 rename；final 存在时不覆盖，不删除，不回滚。`executeArchivePublish` 在该步骤之后及其 catch 路径只有业务/任务状态 DML，不会移除 final。交接前必须同时验证 final 的封存 manifest 摘要与身份、必要目录存在，以及原 staging 路径明确不存在。仅检查 final 存在不够。封存代已 sealed 且 drained，下载执行不能再创建 staging；旧发布即使停在 rename 前，迟到动作也因 staging 不存在而失败，且非空 final 不允许被 rename 覆盖。交接后的执行跳过文件准备步骤，只进入现有 fenced DML 发布。

专用数据库交接须在当前 `BACKGROUND_WRITER` fence 的短事务内逐项校验：同一 `ArchiveImport`/`ArchiveImportExecution` 的 PUBLISH job、当前活跃 execution token 和 attempt、旧声明来自该 job 的较早 attempt 且旧 token 已失效；声明的 session 必须精确为 `archive-publish:<archiveImportId>`，root identity、final DIRECTORY 范围、无 parent/上传信息、声明版本及原 source token 完整范围必须一致。持久 staging generation 必须与该业务绑定，sealed/drained 均存在、cleaned 为空、manifest 摘要相同，且没有 cleanup 请求、删除保护或作品来源变化。外部文件证明只能由执行器根据服务端路径与已封存摘要生成，不能接受客户端布尔值或任意路径。

交接以 CAS 更新该声明 owner/execution 与声明版本，原 token 和 source gate 保持，不能增加文件范围、放开目录或重算 source epoch；新 handle 随新版本返回。旧 handle/旧 execution 的所有后续 DML 必须被 runtime fence 或声明版本拒绝。任一证明缺失或校验失败均保留原 gate。实现测试保留既有 rename-before-commit 恢复案例，并覆盖 staging 仍存在、manifest/业务范围不符、清理已请求以及旧 execution 晚到发布被拒绝；恢复不得重新下载、复制或读取媒体内容计算摘要。

```ts
rebindCompletedArchivePublicationMediaWrite(tx, input: {
  owner: MediaContentOwner
  previous: {
    owner: MediaContentOwner
    handle: MediaContentWriteHandle
    source: MediaContentSourceWriteToken
  }
  expectedArtworkId: number | null
  proof: {
    kind: 'FINAL_VERIFIED_STAGING_ABSENT'
    archiveImportId: string
    generationToken: string
    manifestSha256: string
    stagingPath: string
    finalDirectory: MediaContentDirectoryKey
  }
  now: Date // runtime queue clock
}): Promise<MediaContentResult<{
  owner: MediaContentOwner
  handle: MediaContentWriteHandle
  source: MediaContentSourceWriteToken
}>>
```

归档手工 retry 的受限入口：仅原 ARCHIVE_PUBLISH / PUBLISH 且存在本 job 的唯一 ACTIVE DIRECTORY 声明、原 ArchiveImportExecution 绑定未变时，复用原 FAILED job 排队并预留下一 attempt。保持 payload、质量、封存成员与业务绑定，下一执行仍必须通过上述文件证明；不在控制事务中宣称文件已恢复。其他 job/session 的声明、已取消 job、子上传、范围或画质改变均拒绝；无声明的既有 retry 保持创建新 job。该入口不补齐 rename 前崩溃的文件恢复能力。原位恢复清除旧失败已读标记，避免下一 attempt 的新失败被隐藏。

`proof` 仅由受信执行器的 manifest/目录验证产生，不能从客户端 DTO 接收。旧声明必须为无子声明、无上传 checkpoint 的 ACTIVE DIRECTORY；按精确 job/session 的受信查询取得 previous 后，helper 再锁内核对完整字段及版本。已经交接到同一当前 execution 的同步重放仍需完整证明，返回现有 handle，不再加版本。RECOVERY_REQUIRED、终态、其他业务类型及继续文件写入的恢复均不在该接口范围内。

### Image/Artwork 源状态 helper

```ts
interface MediaContentSourceWriteToken {
  writeToken: string
  artworkIds: number[]
  imageIds: number[]
}

beginMediaContentSourceWrite(tx, input: {
  artworkIds: number[] // 整作；最多 100
  imageIds: number[] // 指定媒体；最多 100
  writeToken: string
  now: Date
}): Promise<MediaContentSourceWriteToken>

finishMediaContentSourceWrite(tx, input: {
  token: MediaContentSourceWriteToken
  outcome: 'committed' | 'verified-rollback'
}): Promise<boolean>

resumeMediaContentSourceWrite(tx, input: {
  token: MediaContentSourceWriteToken
}): Promise<MediaContentResult<MediaContentSourceWriteToken>>
```

这些是 owner 生命周期内部的低层 helper，不能替代路径声明。开始文件写前建立持久路径声明并推进受影响 source；最终低层 finish 必须在 owner publication 回调事务内完成，token 不匹配使整个事务回滚。整作 begin 推进 revision + mediaEpoch，指定媒体 begin 仅推进目标媒体与其作品 revision；任何已有源 gate 拒绝重入，版本不回退。后续上传块不重复 begin，沿用原 token。

Worker 已确认前一次调用退出后，同一个 session/job/executionToken/attempt 的同步重放可用完整 owner 与声明范围派生的稳定 writeToken 调用 path begin 幂等分支；只能返回 ACTIVE/READY，RECOVERY_REQUIRED 返回 WRITING，COMPLETED/ROLLED_BACK 返回 STALE，不能再次写文件。然后 resume 校验该 source token 当前持有的完整 artworkIds/imageIds 与输入完全一致（各最多 100），返回原 token 且不推进任何 revision/epoch。目标实体存在、没有此 token 的 gate 且目标也没有其他 token 时返回 MISSING，允许首次 source begin；其他 token、部分范围或范围扩大均返回 STALE。空范围合法返回 READY。源 token 短事务使用同 token 的事务级锁串行校验，锁在 Artwork 前取得。此接口不认领按路径发现的记录，不允许跨 execution/attempt 接管；恢复仍遵循停写流程。

## App 同步删除恢复契约

此入口仅用于既有非归档作品删除、Image 物理删除和章节物理删除，不接管 Worker 声明。预览生成 UUID operationId；开始请求带该 ID 及精确 selectedPaths。 单媒体和章节预览同时返回 memberDigest（原成员快照的 SHA-256），tRPC/HTTP 与确认框原样提交 operationId/selectedPaths/memberDigest；首次持久 manifest 和建立 gate 前，当前允许文件集合及成员摘要必须与该预览完全一致。关联、路径或成员属性变化即拒绝并要求重新预览，不能用旧 operationId 重新选择新文件。恢复预览的选择及摘要始终来自原 manifest。服务端在 `.pixishelf-upload-recovery/deletions/<kind>-<targetId>/` 保存当前 intent manifest，记录 `version/operationId/userId/kind/targetId/rootIdentity/writeToken/relativeDirectory/artworkIds/imageIds/members/selectedPaths/files/directories/preview/report`。token 由服务端生成后随 manifest 固定，不由客户端指定。文件属性采用十进制字符串；逐文件状态为 PENDING 或 ABSENT，缺失初态也明确记录。manifest 原子 rename 前以 0600 写临时文件并 fsync，rename 后 fsync 父目录；恢复目录的创建也同步父目录，拒绝符号链接与硬链接。

在持有既有目录文件锁时：先冻结和持久 manifest，再以其固定 owner（同账户、operationId、sessionVersion=1、execution=null）及 token 建立唯一 DIRECTORY 声明和精确 source 范围，保存 handle，复查成员快照，才允许首个 unlink。目录范围取全部选中文件与目标成员路径的共同父目录；空选择仍保护目标 source。原子 manifest 写入失败不能继续 I/O；gate 建立后、handle 回执前崩溃可按原 token 幂等取得 ACTIVE 声明。已存在 manifest 的恢复不接受新 operationId 或改选；不能通过 begin 重新观察媒体扩充 source 范围。

每次重试先比对根、账户、目标类型/ID、operationId、原选择和持久 handle，再检查数据库 gate。ACTIVE 才可继续文件处理；COMPLETED 表示业务提交已与 gate 原子完成，只返回完成结果。其他状态、成员快照变化、声明范围变化均停止。单文件 unlink 前重新 lstat 并核对 dev/inode/size/mtimeNs/ctimeNs；缺失可作为上次 unlink 后尚未写回 manifest 的恢复依据。每次确认缺失后持久 ABSENT，再处理下一项。ABSENT 路径重新出现或 PENDING 路径身份不同均停止，不删除新占用者。目录仅遍历冻结清单并使用 rmdir，不递归；新增内容保留。任何不确定错误均保留 gate 和 manifest。

同账户 preview 返回原 operationId、选择和操作说明；其他账户不得取得原清单或 token。客户端不接收服务端文件 token，重试的授权来自登录账户和精确 operationId。同目标的新操作开始前将历史已完成 intent 按 operationId 原子归档，再替换当前 manifest；历史回执保留以拒绝旧 ID 重启文件删除。完成回执只影响展示，不承担源 gate 解除。进程崩溃留下的 `.replace-write-lock` 仍按现有停写恢复手册核对，不依据超时抢占。

## 离线恢复授权

新增独立 `MediaContentRecoveryGrant` 与正式增量迁移，保存 inspect 快照摘要、原 job/session/owner、全部声明版本与 source 范围、指定下一 attempt、停写确认、备份检查点及一次消费证据。它不复用上传 child disposition，不靠声明超时自动解锁。

六张核心表由 `20261023002000_media_content_fingerprints` 建立；第七张授权表由独立的 `20261023003000_media_content_recovery_grants` 增量迁移建立，不重写前一迁移。授权状态为 ACTIVE / CONSUMED / REVOKED；同 job/session 最多一份 ACTIVE。表保存 JSON 快照及 SHA-256、expectedAttempt/targetAttempt、operator/backupCheckpointRef，以及消费 execution token/时间或撤销操作者/原因/时间。SystemJobEvent 另存审计事件；事件裁剪不影响授权状态。

管理员必须停止所有 App、Worker 和外部媒体写入，确认进程与文件流退出，并保全数据库、媒体及领域恢复检查点。CLI `inspect` 只读导出指定 job/session 的精确 root/scope/version/source 与领域证据；`confirm` 以快照摘要 CAS 复核现场、旧 job 非活跃且没有有效执行租约，授权该原 job/session 的 `currentAttempt + 1`。快照变化、仍有有效租约、范围缺失/超限均拒绝。确认不会解除任何 gate 或触碰文件。完全相同授权输入的重放仍须重新完成全局停写、根身份、领域与声明/source 版本检查；只有完整规范快照、摘要、job/session、expected/target attempt、operator、backupCheckpointRef 全部一致的 ACTIVE 授权，才返回原 grantId/nextAttempt，不增加授权或审计。已有 ACTIVE 授权与任一输入不符即拒绝；已消费或撤销的原授权输入不能重新激活或重放。撤销后如需重新授权，须显式提供新的备份检查点并重新核对现场。

inspect / confirm 在任何 job 或内容锁之前，按 `lane/archive-download`、`lane/archive-resolve`、`lane/background-writer` 顺序取得与 runtime 领取任务共用的事务 advisory 锁；争用即返回 WRITING。随后拒绝任意通道 RUNNING/PAUSING/CANCELLING 任务、任意有效 resource lease，以及 60 秒内 STARTING/READY/DEGRADED Worker 心跳。即使 lease 行尚不存在，领取锁也保护检查到授权提交之间的窗口。App / 外部写入停机仍须操作者明确确认；CLI 还必须用共享物理根解析器复核每个声明的 rootIdentity，不能仅信任库内根值。正常运行中的 consume 不执行全局停写检查。

Worker 的共享 begin 适配器只在当前 runtime fence 内消费这份授权：校验当前 job/payload/session/attempt、全部原声明与 source 快照、领域证据，原子更新完整声明集合的 owner/execution/declarationVersion，保留 writeToken/source epoch 和原 scope，授权一次消费并保存审计。调用方要求的目录和 source 集合必须完全一致。无授权普通 retry 仍拒绝；旧 owner 与旧 handle 永远不能发布或结束新 owner 的声明。消费后仍须沿原领域状态机逐文件核对与恢复，只有最终 owner publication 才能结束 gate。

允许恢复的领域限定为 `PENDING_REPLACE`（BATCH/RESTORE）、`MIGRATION`、`VIDEO_STREAMING_OPTIMIZATION`、`ARCHIVE_MAINTENANCE`（TRASH_ARCHIVE/RESTORE_ARCHIVE/PURGE_ARCHIVE）与尚需文件发布的 `ARCHIVE_PUBLISH`。共享 `readExecutorMediaRecoveryDomainSnapshot` 由服务端解析 job payload，并校验 session 的业务身份；inspect、confirm、consume 均调用同一个读取器，不能接受调用方自报的任意摘要。替换冻结操作绑定、item 状态、路径和 manifest；迁移冻结 item 与最多 5000 条 file checkpoint；视频冻结目标 Image 身份和路径；归档维护冻结作品生命周期与全部 revision 的版本化摘要及精确数量。revision 按稳定 ID 升序 keyset 分页，每页最多 100 条，逐项编码 `id/archivePath/trashPath/trashedAt/purgeAfter` 并流式计算 SHA-256，不截断、不累计全部行；快照仅保存摘要版本、十进制精确 count 与摘要，大小不随版本数增长。第 101 条及后续任意 revision 的路径、日期、增删变化同样使 inspect 后的 confirm/resume/consume 复核失败。这里的分页大小不构成作品版本数量上限，也不改变文件系统操作的原精确 revision 清单或通用目录声明上限。较大 manifest/成员快照只输出有界摘要，事务不读取媒体文件。任务领取时会变化的普通进度、updatedAt、batch startedAt 不参与领域摘要。

`ARCHIVE_PUBLISH` 的 rename 前中断复用同一离线授权：session 必须为 `archive-publish:<archiveImportId>`，原 job、payload、PUBLISH execution 与 import 的 generationToken 精确绑定；generation 已 sealed/drained、未 cleaned，manifest 摘要一致，没有 cleanup 意图或已发布 revision，关联旧作品仍活动。领域快照冻结来源身份、stagingPath、generation、manifest 与作品身份，不包含领取时变化的 import status/startedAt。恢复排队只将该原 PUBLISH import/job 同事务恢复 PENDING，不重建下载代、不修改 manifest/items。当前执行在短事务消费精确 final DIRECTORY/source 范围的授权后，才可继续已有 manifest 校验与 staging→final rename。任何普通跨 attempt begin 仍拒绝。已经 rename 的 final 继续优先使用上文专用“完整 final + staging 不存在”交接，仅做 DML；此处不放宽自动接管证明。

未解决的 PUBLISH 声明同时阻止手动及 RECONCILE 的 CLEAN_STAGING。清理执行器在既有发布协调锁内再次检查原 job/session 的未终结声明，拒绝删除 staging/final、manifest 或清除 generation 绑定，提示先恢复原 PUBLISH。

正式导出接口如下，所有写入仍由调用方现有短事务承载：

```ts
type MediaContentRecoveryDomainReader = (
  tx: MediaContentTransaction,
  input: { jobId: string; sessionId: string }
) => Promise<Prisma.JsonValue>

parseMediaContentRecoverySnapshot(value: unknown): MediaContentRecoverySnapshot

inspectMediaContentRecovery(tx, input: {
  jobId: string; sessionId: string; now: Date
  readDomainSnapshot: MediaContentRecoveryDomainReader
}): Promise<MediaContentResult<{ snapshot: MediaContentRecoverySnapshot; digest: string }>>

grantMediaContentRecovery(tx, input: {
  snapshot: unknown; expectedDigest: string
  backupCheckpointRef: string; operator: string; confirmAllWritersStopped: true
  now: Date; readDomainSnapshot: MediaContentRecoveryDomainReader
}): Promise<MediaContentResult<{ grantId: string; nextAttempt: number }>>

consumeMediaContentRecovery(tx, input: {
  owner: MediaContentOwner
  expectedScopes: Array<{ directory: MediaContentDirectoryKey; scope: MediaContentWriteScope }>
  artworkIds: number[]; imageIds: number[]
  now: Date; readDomainSnapshot: MediaContentRecoveryDomainReader
}): Promise<MediaContentResult<{
  owner: MediaContentOwner; handles: MediaContentWriteHandle[]; source: MediaContentSourceWriteToken
}>>

revokeMediaContentRecovery(tx, input: {
  grantId: string; operator: string; reason: string; now: Date
}): Promise<MediaContentResult<{ grantId: string; status: 'REVOKED' }>>
```

`MediaContentRecoverySnapshot` 是可 JSON 序列化的版本 1 对象，顶层为 `version/job/sessionId/domainSha256/claims/source/artworkStates/imageStates`。`job` 包含 id/type/attempt/status/payloadSha256；claims 包含序列化 handle、owner、directory 和 ACTIVE/RECOVERY_REQUIRED 状态，必须覆盖该 job 的全部活动声明且归属同一 session，最多 100 个、仅顶层非上传声明。source 保留精确 writeToken 和各最多 100 个 artworkIds/imageIds。artworkStates 冻结所有相关作品 revision/mediaEpoch/memberCount/writeToken；imageStates 冻结源 revision/token、成员归属、path/size。所有 bigint 用十进制字符串；规范 JSON 键按字典序排列、数组顺序固定、深度最多 32、总大小最多 1 MiB，SHA-256 绑定完整内容。解析快照仅验证结构，不能凭输入快照直接执行变更，confirm 必须与新取得的锁内快照一致。

consume 先只读检查精确 job/session 的 ACTIVE 授权或当前 attempt/token 已 CONSUMED 授权；没有候选直接返回 MISSING，不给普通 begin 增加 job 类型、时间或恢复锁要求。有候选才取得现有 resource/job fence 并重新读取验证。首次消费绑定完整授权前快照。已消费授权仅同 execution 可幂等返回，仍校验完整声明身份/范围/新版本和精确 source token 集合、领域仍属于该 job/session；允许本 execution 合法推进的领域 checkpoint 与 source revision 变化，不再次比较授权前摘要、不再次推进版本。任何终态声明不允许恢复写入。撤销仅限尚未消费的授权，保留全部 gate；重复撤销幂等，已消费授权返回 STALE，不能用撤销撤回已经运行的执行。

已授权任务通过 `resumeGrantedMediaContentRecovery(tx, { grantId, operator, confirmAllWritersStopped: true, now, readDomainSnapshot })` 显式恢复原 job；CLI 命令为 `resume --grant <id> --operator <name> --confirm-all-writers-stopped`。接口仅接受 ACTIVE 授权，按 inspect 的全局停写锁、resource/job/授权行锁与完整快照检查确认原 job、session、expectedAttempt 和下一 targetAttempt。首次只接受授权快照中的 FAILED / PAUSED / PENDING 状态，原 job CAS 到 PENDING，清空 finishedAt、error/errorCode、pause/cancel 请求和执行租约，availableAt 设为当前时间，maxAttempts 至少覆盖 targetAttempt；显式恢复使用 RETRY 触发和手动优先级、清除旧 deadline，避免历史调度窗口阻止恢复。授权保持 ACTIVE，只有 Worker 可消费。不会创建新 job 或放宽普通 retry。

重复 resume 只在同一授权仍 ACTIVE、原 job 仍 PENDING 且 attempt 未变、已有该 grant 的 `job.queued` 审计证据时幂等返回；比较快照时只将这次已证明的 PENDING 状态还原为授权前状态，其余 job 身份、类型、attempt、payload 摘要与全部领域/source/声明快照必须精确一致。排队参数变化不属于内容快照，但首次与重放都须满足全局停写检查。已消费、已撤销、其他 attempt 或内容快照变化均拒绝。App 普通 FAILED retry 如存在未解决声明，拒绝创建新任务并指向原任务离线恢复。

旧 gate 拒绝须进入各领域现有 ACTION_REQUIRED 暂停路径，不能被逐项异常处理吞掉并把任务标为完成，也不能连续自动重试耗尽 attempt。验收包括：无授权拒绝、inspect 后状态变化拒绝、有效租约拒绝、错误下一 attempt/范围拒绝、一次消费、同 execution 重放，以及替换/迁移/视频的既有断点恢复在授权后可实际完成。

## 数据库锁、直接 SQL 与实施验证

统一锁顺序：现有 job/resource fence → 目录状态按稳定 key 升序 → 路径声明按 ID → Artwork 按 ID 升序 → ArtworkContentSource → 目标 Image 按 ID `FOR KEY SHARE NOWAIT` → MediaContentSource/Fingerprint → ArtworkContentFingerprint。扫描/读取和 owner publication 都用同一目录数据库锁；“共享”表示共用协议，不在文件读取期间保持数据库锁。

多目录读取先有界取得本批目录身份，再按上述顺序锁目录及作品并复查；不能先锁 Artwork 再补锁目录。最终全量完整性检查通过作品全局 revision 及数据库聚合验证已绑定目录状态，不在持有 Artwork 锁时等待新增目录锁。目录写在推进 generation 时同步推进绑定作品 revision；因此并发变化要么在当前提交之前被拒绝，要么在之后使结果失效。

PATH/DIRECTORY 声明开始与结束均推进声明目录及所有已建立祖先（包括根目录）的观察 generation，确保递归扫描父目录时，发现与发布之间完整穿过的新子路径写入仍使旧快照失效。DIRECTORY 另推进其已有子树目录。作品版本只按这些实际受影响目录的直接绑定推进；根 generation 变化不递归使其他子目录的全部作品失效。owner 发布仍不比较声明起始 generation。

Image 语句级 transition-table 触发器覆盖 INSERT/DELETE，以及 UPDATE 的 artworkId/path/size 变化，批量推进旧/新作品 revision 和变更媒体 source；纯排序、标题、时间刷新及其他非内容字段不推进。触发器先按作品 ID 升序处理，再更新 source，不反向取目录锁。路径/成员移动后不得保留不匹配的旧目录绑定。

直接 DELETE Image 可能先持有 Image/FK 级联锁再进入作品触发器；helper 在媒体源/cache 写前使用 KEY SHARE NOWAIT，避免持作品锁等待该 Image。跨作品多语句直接 SQL 仍可能产生可重试死锁，整个事务回滚后重试。不得在事务失败后只重放最后一条更新，也不得重跑已经执行的文件 I/O。

实施测试在[第一阶段验收](./01-fingerprints.md#验收案例)基础上至少覆盖：分页中修改成员、绕过 helper 的直接 SQL、旧 token/旧租约/旧 epoch、超过 JS 安全整数的属性、缓存命中零内容读取、同目录不相交 PATH 完成、DIRECTORY 与内部路径冲突、无 Image 的暂停上传、最后块 READY 后扫描仍拒绝、回执响应丢失重放、其他账户无法取 checkpoint、owner DML 后最终 CAS 失败整体回滚、先发扫描与完整上传竞态，以及目录/Artwork/Image 锁竞争下的失败或可重试完成。正式迁移只在隔离空库及非空旧 schema fixture 验证，不访问真实媒体。

## 作品指纹 v1 的精确编码

本节是跨包和后续重建必须遵守的字节协议，依据 `packages/pixishelf-job-executors/src/media-content/fingerprint.ts`。算法版本变更必须另起版本，不复用已发布摘要。

`field(text)` 表示：先写 4 字节无符号大端 UTF-8 字节长度，再写 UTF-8 正文；不使用 JavaScript 字符数。大小、数量、代次均先以无前导零的十进制整数编码，禁止转换为浮点数。摘要以小写十六进制入库，参与下级哈希时解码为 32 个原始字节。

内容摘要顺序：

1. `field("pixishelf-artwork-content-v1")`；
2. `field(登记原文件总数)`，数量必须大于零；
3. 按数值大小升序、SHA-256 的 32 字节字典序升序遍历全部成员，逐个写入 `field(size)` 与原始 SHA-256 字节。相同成员出现几次就写入几次；Image ID 只用作数据库游标的稳定第三排序键，不进入内容摘要。

读取过程中只保存前一项与计数，不构建整作无界数组。排序不合法、成员缺失、额外成员、零字节或摘要格式不合法均拒绝发布。

成员签名独立使用 `field("pixishelf-artwork-members-v1")`、`field(artworkId)`、`field(memberCount)`，之后按 Image ID 严格递增写入每项 `field(imageId)`、`field(canonicalPath)`、`field(sourceRevision)`。它证明本次发布绑定的成员范围，不参与判断两部作品内容是否相同。纯排序和标题变化不改变内容摘要；改名改变成员签名，但同字节内容摘要不变。

## 根与遗留写入的恢复边界

根配置、Pixiv 根标记、规范绝对路径、设备号或 inode 变化均停止使用原缓存与快照。不得新建 namespace 绕过已有声明，也不得仅删除缓存表来清除原文件写入保护。重新配置根前，先按备份恢复基线停止 App、Worker 与全部外部写入，保存数据库与媒体同点检查点，核对每个未终结写入的文件状态；恢复证明与根身份确认是两个独立步骤。

普通重试只能使用原 execution 的精确 owner/范围；跨 attempt 恢复必须有该领域的可执行证明与显式 CAS。已封存归档的“文件已发布、只剩数据库提交”交接按上文专用协议；不能把它扩展为迁移、替换、清理的自动接管。阶段验收必须覆盖这些既有业务的崩溃恢复，不能把永久阻断记为恢复成功。

### 取消与遗留声明

运行中的任务取消仍由原执行者停止文件工作并完成已验证的回滚或安全收口，再在同一个 fenced finalizer 中结束自身声明与取消任务。数据库取消状态不是文件恢复证明。

对于已暂停、等待重试或尚未再次领取、但持有未解决媒体声明的任务，控制入口拒绝直接改为 CANCELLED，保留原业务 ID 和恢复入口，提示先完成恢复。该限制同时覆盖 App 通用控制、归档专用控制和 runtime 请求取消；未发生文件写入的排队任务仍可直接取消。不增加自动解除声明或对 CANCELLED 任务的通用接管能力。 运行中的任务如仍有其他 execution token 或 attempt 的未终结声明，同样拒绝请求取消；只有当前执行拥有全部声明，才允许原执行者验证回滚后收口。控制检查遵循 resource lease → job 锁顺序，与声明建立及执行 finalizer 串行。归档单项与批量 PAUSE / RESUME / CANCEL / RETRY 均先锁定原绑定的 resource lease/job，再取得发布 coordination advisory lock；锁后重读绑定与状态，保留原状态 CAS。不得先持 coordination 再等待 job，否则会与 Worker fence 或其他控制动作形成反向锁依赖。

受限的租约回收例外：仅当 CANCELLING 的执行租约已过期且该 job 仍有 ACTIVE / READY / RECOVERY_REQUIRED 声明时，回收结果改为 PAUSED，消息为“取消未完成，需恢复处理”，原因记为 ACTION_REQUIRED。保留原 job/session、声明版本与全部 source gate，不自动继续；清理执行租约并清空 cancelRequestedAt，以允许离线检查，原取消时间及未完成原因保留在同事务 job.paused 审计事件。所有领域同步均使用最终 PAUSED 结果，不能将领域对象记为已取消。无遗留声明仍按原规则取消。

该特殊暂停中，替换、迁移、视频、归档维护与尚需文件发布的 ARCHIVE_PUBLISH 必须先按停写流程取得原 job 的下一 attempt 授权，再由管理员显式继续；普通继续不能跳过授权。ARCHIVE_PUBLISH 已完成文件发布的情形仍适用上文专用证明，由原 job 新 attempt 核验完整 final 与 staging 不存在，仅继续 DML；rename 前情形按离线授权继续精确文件工作。原执行者发现无法证明安全收口时抛出恢复错误，等待上述租约回收；不放开 scope.pause 的 CANCELLING 状态，也不伪造已验证回滚。
