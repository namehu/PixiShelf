---
status: draft
scope: 第二阶段检测持久化、执行器与 App 接口实施契约
last-verified: 2026-10-23
sources:
  - packages/pixishelf-db/src/artwork-dedup.ts
  - packages/pixishelf-job-contracts/src/artwork-dedup.ts
  - packages/pixishelf/services/artwork-dedup-service.ts
---

# 第二阶段实施契约

只实现检测，不提供审核、隔离和删除。所有执行器写入必须在现有 `fencedTransaction` 内进行，先校验 runId、jobId、executionVersion；控制请求取得 resource lease/job 锁后取得 run 锁。表采用 ArtworkDedupRun、ArtworkDedupItem、ArtworkDedupMedia、ArtworkDedupGroup、ArtworkDedupGroupMember、ArtworkDedupCommand。Item 和 Media 使用复合主键，媒体和组成员分别分页，不存大 JSON 或两两关系。冻结范围采用有效 ArtworkArtist 证据、活动未删除作品；冻结 Artwork.mediaRevision，处理前及发布前复核。

`ARTWORK_DEDUP_SCAN@1` payload 严格为 `{runId, executionVersion}`。固定 SYSTEM、priority/effectivePriority 900、BACKGROUND_WRITER，禁止通用创建、控制、重试、子任务创建；领域控制保持原 runId，retry 增 executionVersion、重新关联 job。活动 run 包括暂停状态，数据库 partial unique index 保证每 artist 一个。控制幂等记录绑定操作者、请求 key、run、expectedVersion、动作；重放先于版本检查。

## 执行器接口

数据库 helper 全部接收 `Prisma.TransactionClient`；`ArtworkDedupExecution = {runId, jobId, executionVersion}`。`assertArtworkDedupExecution(tx, execution, {allowControl?})` 锁 run 并校验关联和执行版本。调用方负责现有执行租约围栏；helper 不替代它。

- `readArtworkDedupItemsPage(tx, {execution, afterArtworkId?, limit?, statuses?})` 返回持久 Item 数组，上限 100。
- `saveArtworkDedupItem(tx, {execution, artworkId, data})` 保存有界单项 checkpoint；data 使用 Prisma.ItemUpdateManyMutationInput；禁止改变身份和冻结 mediaRevision。
- `saveArtworkDedupMediaPage(tx, {execution, artworkId, entries})` 幂等保存最多 100 个可靠 stat 记录。每行包含 imageId、sourcePath、sourceRevision、logicalRoot、rootIdentity、relativeDirectory、directoryId、directoryGeneration、canonicalPath、size、mtimeNs、ctimeNs、deviceId、inode；sha256 可空。
- `readArtworkDedupMediaPage(tx, {execution, artworkId, afterImageId?, limit?})` 按 imageId 分页，上限 500。
- `updateArtworkDedupRun(tx, {execution, data, allowControl?})` 保存阶段与聚合计数，不允许更改执行身份、版本、冻结范围。
- `assertArtworkDedupItemCurrent(tx, {execution, artworkId})` 复核冻结 mediaRevision、有效艺术家范围和活动状态，返回 boolean。
- `buildArtworkDedupGroups(tx, {execution})` 仅按 COMPLETE 项的指纹和已持久的媒体规范多重集合进行数据库精确验证后建组。最终发布必须与 scope.complete 同事务。

Item 状态 `PENDING | STATTING | SIZED | HASHING | COMPLETE | UNIQUE | CHANGED | FAILED | SKIPPED`。阶段 `STAT | CANDIDATES | HASH | GROUP | DONE`。Item checkpoint：snapshotRevision/mediaEpoch/memberCount、afterImageId、sizeDigest、contentSha256、membersSignature、errorCode。可靠 stat 独立于阶段1缓存，候选按 count+sizeDigest 初筛后核对大小多重集合；HASH 阶段按保存的 stat 重查源证据。

STAT 成员页保持 500；HASH 同步读取成员页与可靠属性页时以缓存提交批 `cacheBatch=100` 为上限，处理并持久化同一批后推进 imageId 游标，避免每次读取 500 却仅消费 100。纯缓存命中批提交使用 `assertArtworkContentSnapshot(tx,{snapshot})` 复核已捕获的 revision/mediaEpoch/writeToken，继续信任该快照的 memberCount，不在每批重数整件作品。该 helper 仅包装既有 Artwork 锁与快照校验；成员增删、路径或源变化、源/目录写入开始都在同一 Artwork 锁协议下推进 revision，所以旧快照必被拒绝。初始 STAT 的完整计数、最终指纹聚合及发布的完整成员计数、目录和租约围栏保持原样。

## App DTO

所有调用在 authProcedure 中验证 expectedUserId 与 Session 一致；实例管理事实共享，不把 requestedBy 误作账户隔离。requestedBy 仅记录发起者；私人标记不返回。

- start `{artistId, expectedUserId, idempotencyKey, mode:'INCREMENTAL'|'FULL'}` → RunDto。
- getRun `{runId,expectedUserId}` 或 `{artistId,expectedUserId}` → RunDto|null，artistId 优先返回活动 run，否则最近 run。
- control `{runId,expectedUserId,expectedVersion,idempotencyKey,action:'pause'|'resume'|'cancel'|'retry'}` → RunDto。
- listGroups `{runId,expectedUserId,cursor?,limit?}` → `{items,nextCursor}`，limit 1–50，组成员预览最多 3 个，只返回作品 id/title 与计数。

RunDto 为 `{runId,artistId,artistName,jobId,version,executionVersion,status,stage,mode,frozenAt,startedAt,finishedAt,counts:{artworks,processedArtworks,completeArtworks,changedArtworks,failedArtworks,skippedArtworks,groups,duplicateArtworks,statMedia,hashedMedia,cacheHitMedia,readBytes},allowedControls,failure}`；日期为 ISO 或 null，readBytes 为十进制字符串。failure 为 `{code,message}` 或 null，不返回路径、哈希或任意异常文本。

最终 GROUP 在现有 resource/job fence、run 锁之后，先复用 `lockCreatorCatalog` 创作者协调锁，再按 Artwork ID 升序锁住本 run 全部 COMPLETE 项对应的作品行。作品 ID 的排序和锁定在数据库内完成，不返回全集 ID；该事务不再取得目录或 Image 锁。锁保持到调用方 `scope.complete` 的最终租约 CAS 及事务提交，以同一创作者协议和阶段1内容写入/触发器协议串行化有效归属、成员及内容源变化。写入先取得锁时，检测等待后使用新的语句快照复核；检测先取得锁时，写入等到完成提交后才能使证据失效。围栏失败则建组和完成整体回滚。

最终 GROUP 在同一 fenced 事务中复核 COMPLETE 项当前有效归属、冻结 mediaRevision、ArtworkContentSource revision/mediaEpoch/writeToken，以及阶段1已发布指纹的同一 revision/mediaEpoch、memberCount、membersSignature 和算法版本。失效项转 CHANGED 后排除，其他完整组仍可发布。观察外部属性变化时，仅接纳本执行阶段1 observe CAS 返回的新 snapshotRevision；冻结 Artwork.mediaRevision 不变。

候选和结果组使用 PostgreSQL 有序规范多重集合聚合，精确文本仅在语句内存在，不保存大 JSON 或在 Worker 构造全集数组，也不创建两两比较关系。sizeDigest/contentSha256 是小型检索证据，不替代精确多重集合相等。

readerToken 持久占用跨暂停、失败、租约回收和 Worker 重启保留；STARTING 先于 spawn，ACTIVE 需要进程身份已持久后才能发出首个媒体读取。readerOwner 保存 version、machineId、bootId、pidNamespace、parentPid、childPid。同机可证明退出或实际 close 才清除，未知现场只能停写后通过离线 inspect/精确 token CAS 恢复入口确认。该入口不改变文件或源 gate。retry 不清 reader 占用。正常 retry 清理临时 stat/组并重新检查原冻结作品，复用阶段1已提交缓存。

运行首次解析媒体根后保存版本化 `rootBindings = {version:1, source:{logicalRoot,rootIdentity}, archive:{logicalRoot,rootIdentity}, archiveRelativePrefix}`。`archiveRelativePrefix` 保存有效归档路径映射，分离根或归档根等于源根时也必须显式保存空字符串；嵌套归档根继续共用源根命名空间，不另造物理根身份。每个 slice 开始及结束均重新核对全部绑定字段，retry 保留原绑定并执行同一核对。任何逻辑根、物理身份或映射变化均以 `ROOT_CHANGED` 停止整个 run，不能继续使用旧 canonicalPath 或发布组。

兼容策略为保守拒绝：已有非空绑定缺少 version 或 archiveRelativePrefix 时，无论当前配置是否看似相同，均报 `ROOT_CHANGED`，不补齐、不替换原绑定。空绑定仅可在尚未处理的 STAT run（全部 Item 为 PENDING、没有已持久媒体证据且 stat/hash/cache/read 计数均为零）首次写入；已有进度但绑定为空也拒绝。旧 run 必须保留为失败记录，在核对当前根配置后另建检测，不能借 retry 静默接受新映射。全局唯一 reader 占用释放与根身份授权分离，离线 reader 恢复不能接受新媒体根。

离线命令为 `artwork-dedup-reader-recovery inspect --run <runId>`，核对停写和返回的摘要、原 reader token 后执行 `recover --run <runId> --expect <digest> --expected-reader-token <token> --operator <operator> --confirm-all-writers-stopped`。命令必须在停止 App、全部 Worker 与外部写入后运行；数据库同时检查三条通道、有效租约及最近 Worker 心跳。inspect 与 recover 均读取原任务身份；recover 在同事务记录审计，只清当前占用，不更改任务、原文件或缓存证据。

## 检测读取计数与崩溃窗口

`statMedia` 累计已提交的可靠属性检查，包含 HASH 阶段为了缓存复用而执行的属性复核；`hashedMedia` 和 `cacheHitMedia` 只计入已提交文件单元。`readBytes` 是这些已提交完整文件实际读取的字节数，不是媒体声明大小之和，也不是跨进程崩溃可精确恢复的物理磁盘 I/O 总量。

`retryReadBytes` 记录仍存活的执行进程已接收到、但未随完整文件单元提交的读取字节；中断文件重算仍从开头进行。Worker 被直接 SIGKILL 后，最后尚未聚合或持久化的 IPC 进展无法恢复，因此该计数不能证明崩溃期间全部重读流量均被计入。任务进度约 10 秒聚合已接收字节，不逐文件写事件。

正常运行的性能测量使用 Executor `onMeasurement` 提供的 `ReaderMetrics`：实际完成的 inspect/read 数、接收的内容读取字节、累计 stat 延迟、父/子进程采样峰值 RSS、IPC 消息数，以及 slice 耗时和有围栏事务数。事务数不等于 SQL 往返数，后者需要 Prisma query 观测另计；进程 RSS 是采样峰值。内容读取字节不代表底层存储设备实际读盘字节，热页缓存及 NAS 吞吐必须分开报告。取消、杀进程或失联时未收到的尾部字节同样属于不可精确计数窗口。
