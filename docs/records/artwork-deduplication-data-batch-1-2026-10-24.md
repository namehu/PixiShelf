# 同艺术家去重：数据与接口第一批（2026-10-24）

状态：实现中；供第三阶段独立审查，未开放高级操作。基线 c2d6be73，工作树 codex/artwork-deduplication，无提交。用户已授权第三至第五阶段并行编码，实际门禁仍 `ARTWORK_DEDUP_RELEASE_STAGE=2`。

## 本批范围

- 正式增量迁移 107 `20261024001000_artwork_dedup_maintenance`、108 `20261024001100_artwork_dedup_review_choices`、109 `20261024001200_artwork_dedup_inspection_checkpoint`。新增个人审核、稳定维护操作、组/作品/文件分页清单，以及后续声明/来源/收据表；历史清单没有 Artwork/Image 删除级联。已应用迁移不回写。
- job-contracts 维护 payload、严格输入与共享 DTO；最大 2,000 字符、绑定账户/run/version/页面种类/组的分页游标。任务保持 SYSTEM/900/BACKGROUND_WRITER，通用创建/控制/重试/提权入口拒绝维护任务。
- DB `artwork-dedup-review.ts`：独立个人审核 CAS/幂等，数据库内 ALL_RECOMMENDED 冻结，显式选择校验，同组保留项冻结。REPREPARE 新建 operation，并在锁内重新比较源 operation.version；retry 保留原操作和范围。
- DB `artwork-dedup-operation.ts`：有界 Artwork/File/Inventory 页、checkpoint、全局 reader 占用与原 token 释放；目录游标字段和文件步骤接口供执行器接入。文件动作接口只是后续阶段基础，不构成第四/第五阶段验收。
- PREPARE 最终校验锁 ReviewState→既有创作者协调→Artwork ID 升序至完成事务提交；精确比较内容、来源、创作者、全账户手工整理签名。阅读只作推荐与展示，不作为执行授权失效依据。READY 要求实际完整媒体/章节/已登记来源清单与检查状态。
- App service/router 接 `listGroups/saveReview/prepareCleanup/getOperation/listOperations/retryOperation/cancelOperation`；getRun 追加 nullable lastCompletedRun 摘要。私人投影仅当前账户评分/标记/阅读，他人仅布尔保护提示。操作预览不返回内部原路径、hash、reader 身份或其他账户细节。
- 四/五阶段 isolate/restore/preparePurge/purge/allowReimport 路由目前只固定类型并拒绝进入，等待实际保护实现和独立验收，不能视为已支持。
- 账户删除收敛到同一事务：UserBA 顺序 NOWAIT 锁防止新 FK 插入，ReviewState 锁，然后真实涉及作品升序 NOWAIT；与常规 Artwork→User FK 的反向争用整事务受控回滚。维护声明存在时禁止删除对应手工整理事实。

## 定向验证

隔离库仅 `dedup_data_next` 和执行器专用 `dedup_executor_next`，127.0.0.1:55432，正式 migrate deploy 至109及 db:generate。没有写入 dedup_scale、浏览器数据库或真实媒体。

- DB 类型检查通过：`/tmp/dedup-next-final-db-tsc.log`。
- DB 真实 PostgreSQL 审核/发布锁 3 项 + 迁移就绪检查 38 项，41/41：`/tmp/dedup-next-review-pg-final.log`。包含多组冻结/个人选择隔离/幂等、阅读不失效、账户级联删除不能越过 READY 发布窗口、正常新增标记与删除反向锁的真实并发回滚。
- App 长游标/跨范围拒绝、阶段门禁、双账户真实 PG 私人投影，3/3：`/tmp/dedup-next-review-api-tests.log`。
- job-contracts 注册/严格维护 payload/闭合门禁/来源代次唯一输入，2/2：`/tmp/dedup-next-maint-contract-tests.log`。
- UI 所有者窄补 RunDto fixture 后，最后一次集成 App tsc 通过：`/tmp/dedup-next-integrated-app-tsc.log`。DB、job-contracts、job-runtime 类型检查均通过：`/tmp/dedup-next-final-{db,contracts,runtime}-tsc.log`。
- docs:check 212 Markdown 通过。本 agent 默认 docs:diagrams:check 因本机缺少 Playwright Chromium 失败；统筹随后已使用 `WEBP_BROWSER_CHANNEL=chrome` 完成33图源+23内嵌校验，证据见 parallel 记录，未安装浏览器。
- 应用全小写路径检查无输出；git diff --check 通过。未运行全量 build/lint/test，未启动浏览器。

## 冻结文件清单

DB：schema.prisma；上述三条迁移；src/artwork-dedup-operation.ts、artwork-dedup-review.ts、artwork-dedup-user-delete.ts、artwork-dedup.ts（reader 共享占用）、index.ts；src/__tests__/artwork-dedup-review.postgres.test.ts、database-client.test.ts。

契约/运行时：job-contracts/src/artwork-dedup-maintenance.ts、artwork-dedup.ts、index.ts、job-types.ts、payloads.ts、__tests__/artwork-dedup-maintenance.test.ts；job-runtime/src/queue-repository.ts 的维护通用入口保护。

App：services/artwork-dedup-review-service.ts、artwork-dedup-service.ts、user-service.ts、background-task/job-command-service.ts、background-task/job-serialization.ts；server/routers/artwork-dedup.ts；services/__tests__/artwork-dedup-review-service.postgres.test.ts。

文档：phase-3-contracts.md 单一共享细化，及总计划/05/ui-design 的 preparePurge 映射。其他执行器/UI/图源文件由相应协作者维护，不在本批所有权内。

## 尚未完成

PREPARE 执行器/受控真实文件检查由执行器线接入，未在本批宣称完成端到端第三阶段。长期作品/来源声明、全写入口与URL hold、下载 drain、完整隔离/恢复授权与收据核对、purge fresh 复核/授权/tombstone、显式重导和历史GC还需后续批次；不得提升门禁。未知附件保持阻断，不伪造审批事实。


冻结前执行器对接已确认的两项未完边界：`saveArtworkDedupOperationFilesPage` 还需要在数据库内按受信根映射核对全库 Image.path/chaptersPath、Artwork.metaSource、ArchiveRevision.manifestPath 的跨作品及跨角色共享引用，不能直接把 reader 提交的 ownershipStatus 当完整归属证明。`completeArtworkDedupPrepare.logicalBytes` 当前聚合所有行，需改为 COPY 可纳入且无阻断范围的唯一 root/path 字节，无法确认则 null；preparedFiles 才是全部清单行数。两项均列为下一批恢复的优先前置，未完成不得开放 PREPARE；本批只提供审查快照，不宣称第三阶段已完成。2026-10-24 00:47 按统筹指令冻结源码、结束本轮以释放独立审查槽位。


执行器最后补充的下一批接口需求：快照复核增加可选 artworkId，页面提交仅锁/比较当前项，默认全范围只留给最终完成提交，避免每页重扫500k范围；归档 Inventory 还须返回真实 pageIndex 与 ArchiveImportItem/Revision stagedPath/sha/bytes 的有界映射，不允许凭 Image 排序推断 manifest index。执行器读取单个来源清单上限复用16 MiB，超限明确阻断，IPC 只传身份/hash与至多100项的清单页。上述需求已接收，本轮冻结后不再修改业务代码。
