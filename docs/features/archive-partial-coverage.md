---
status: current
scope: E-Hentai 部分归档、显式补全、覆盖范围与旧部分修订退休
last-verified: 2026-10-29
sources:
  - packages/pixishelf-db/prisma/schema.prisma
  - packages/pixishelf-job-contracts/src/archive-download.ts
  - packages/pixishelf/services/archive/archive-completion-service.ts
  - packages/pixishelf/services/archive/archive-coverage-service.ts
  - packages/pixishelf-job-executors/src/archive/intake-enqueue.ts
  - packages/pixishelf-job-executors/src/archive/publisher.ts
  - packages/pixishelf-job-executors/src/archive/retire-partial-executor.ts
  - packages/pixishelf-job-executors/src/archive/retire-partial-proof.ts
  - packages/pixishelf/app/artworks/[id]/_components/archive-coverage-footer.tsx
---

# 部分归档与补全

本文维护 E-Hentai 下载范围、作品详情补全及旧部分修订退休的规则。[收件箱](./archive-intake.md)负责收件与任务控制，[归档生命周期](./archive-lifecycle.md)负责通用下载、发布和维护机制；升级与回退按[专项手册](../operations/runbooks/archive-partial-coverage.md)。本文已按实现核对，不代表生产已部署，验证范围见[隔离验证记录](../records/features/archive-partial-coverage-2026-10-29.md)。

## 下载范围与覆盖事实

添加链接、发现结果入箱、待确认收件入队可以选择“全部”或“前20张”，与自动／手动模式、原图／展示图画质分别保存。`ALL` 为缺省值；`FIRST_20` 取原站媒体顺序的前 20 项，来源不足 20 项时下载全部实际项目。失败重试和修正链接继承原选择，范围参与提交幂等指纹。

解析仍取得完整来源快照和媒体计划，随后在入队时截取下载计划；不能把解析到 20 张就停止当成部分归档。原站页数或计划不完整时仍按既有解析校验失败处理。

| 事实               | 权威位置与含义                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| 本次准备下载多少项 | `ArchiveImport.totalItems` 和逐项计划，部分下载不计入未选中的页面                                          |
| 已发布覆盖范围     | 当前 `ArchiveRevision.downloadScope`、`sourceTotalItems`、`sourcePlanDigest`；来自发布时冻结的完整来源计划 |
| 本地图片数         | `Artwork.imageCount` 及本地 Image；筛选、统计、分页和阅读分母继续只计算本地内容                            |
| 是否仍为部分归档   | 当前范围为 `FIRST_20`、有可信来源总数，且本地图片数小于来源总数                                            |

源总数是解析时的事实，不是每次打开详情都向原站重新查询。历史记录由 migration 默认 `ALL`，来源总数和计划摘要保持空值；不从本地计数猜测或回填历史来源覆盖率。`FIRST_20` 的来源恰好不超过 20 张时已覆盖全部，不显示待补全状态。

再次提交同一已发布来源、普通来源更新或 AUTO 重扫沿用当前修订的范围，不会因为新提交默认 `ALL` 自动扩大既有部分归档。只有作品详情的显式补全命令可以把部分范围变为全部。

## 详情与阅读

部分作品在详情标题附近显示“部分归档”和本地／原站数量；媒体区之后提供“去原站预览”“下载剩余图片”以及已创建任务的入口。该页脚独立于媒体视图，在完整浏览、堆叠浏览和未读筛选下均可使用，未读项为空时仍能补全。补全过程继续阅读既有本地媒体；发布后提示刷新查看全部。

原站入口复用受保护的作品来源重定向，在新标签打开且不发送 Referrer。客户端仅传作品和来源引用 ID，服务器查询并校验目的地址；不恢复站内远端阅读器，也不修改 reader／mediaPage 的本地媒体契约。权限与完整 URL 边界见[权限与接口边界](../security/access-control.md)。

阅读进度只按已下载的图片计算。用户完成 20 张本地内容不表示完成原站全部内容。成功补全保留原有 Image ID 和顺序；路径变化继续触发内容指纹及适用的动画时长失效。补全保留各账户已有阅读记录、单图书签／喜欢及作品评分；新增 Image 没有已读记录。阅读摘要扩展总数并更新状态版本，原来的“全部已读”因此可能变为仍有未读。补全不触发普通全量媒体重建的阅读失效流程。

## 显式补全与失败

`archive.completeArtwork` 为管理 mutation，只接受作品 ID、期望当前修订 ID 和幂等键。服务端在事务内重读 ACTIVE、未删除作品及当前 `FIRST_20` 修订，拒绝已有活动收件／下载、媒体已修改或维护中的情况。旧记录缺少可证明的来源计划或逐图快照时不能补全。

服务端冻结 `completionBaseRevisionId` 与 `completionSnapshot`，包括来源完整计划摘要和总数、原画质、媒体版本、已有 Image 身份／顺序／路径／长度／SHA-256 及内容修订；这些证据不能由客户端提交。补全重新排队解析原来源，解析成功后按已冻结意图自动衔接下载。新的完整计划、总数、原画质或当前基线不匹配时停止并报告冲突，不静默拼接来源新旧版本。

补全沿用原归档的原图或展示图质量，不允许借补全升级画质。已有前 20 项在下载阶段按文件长度和 SHA-256 校验后复制到新的 staging，不重新从网络下载有效副本；缺失或损坏项沿用恢复下载，但发布前仍须匹配冻结的长度、SHA-256 和质量，其余项正常下载。新修订必须包含完整计划并通过原有封存和发布检查。过程中需要临时存放完整作品的空间，旧修订在新发布成功前保持可读。

发布前再次核对冻结基线与本地媒体状态。来源计划变化、无法恢复出与冻结证据一致的原媒体、已有媒体被替换、回收或其他发布抢先完成时，补全失败并保留旧作品；通过任务查看错误，按普通更新流程重新核对来源和本地内容，不能手工删掉快照字段来强行续传。常规暂停、恢复、取消及失败重试继续由[收件箱任务控制](./archive-intake.md#阶段与控制)负责。

## 补全后的旧副本退休

完整修订发布的同一事务保存旧部分修订的退休意图、冻结证据和替代修订 ID，并创建专用 `ARCHIVE_MAINTENANCE@2 / RETIRE_PARTIAL_REVISION`。它只清理这次成功补全对应的旧部分实体，不是通用历史版本清理，也不删除旧修订、归档任务及审计关系。

writer lane 清理前重新证明：旧修订非当前且属于 `FIRST_20`，替代修订为同作品当前 `ALL`、作品 ACTIVE 且画质一致；完整快照包含原有全部媒体身份、顺序、长度和 SHA-256。执行器实际核验替代修订的 manifest 与全部媒体，首次删除前也核验旧副本。旧路径不能仍被 Artwork、Image、章节、活动归档／迁移、携带旧路径的任务或去重保护引用。路径越界、符号链接、未登记文件及无法证明的内容均阻止删除并保留现场。

清理使用原媒体写入声明和持久 `retirementStartedAt` 检查点，成功后写 `retiredAt`，保留 `replacedByRevisionId`。崩溃后只有已有删除检查点才可接受旧目录缺失或删除未完成；不能仅凭目录缺失推断清理成功。失败可在相同领域条件成立时重试，恢复证据按[原媒体写入异常恢复](../operations/runbooks/media-content-recovery.md)保全。

已退休修订保留为历史记录，其旧目录不再是必须存在的实体。回收、恢复、到期清理、reconcile 和相关恢复快照跳过 `retiredAt` 非空的修订；当前完整修订仍按普通归档生命周期处理。清理尚未成功不撤销已经发布的完整作品，旧目录保留供重试或核查。旧程序假定全部 revision 目录都存在，因而不能直接降级继续运行，详见[升级与回退](../operations/runbooks/archive-partial-coverage.md)。

## 验收入口

- 超过、等于及不足 20 张的来源：完整解析、源序截取、缺省全部、来源总数和本地计数各自正确。
- 普通重提、重扫、失败重试不自动扩大部分范围；手动入队和自动入队保存相同范围语义。
- 完整／堆叠／未读视图保留页脚；原站访问继续鉴权，不能通过 query 指定任意跳转地址。
- 补全只下载新增项，保留既有 ID、阅读、标记和评分，新页未读；来源或本地基线改变拒绝发布。
- 退休核验、引用冲突、删除中断和重试，以及完成后回收／恢复／永久清理均尊重退休标记。
- 新旧任务版本可由配套 Worker 执行；旧版消费者不能领取新协议任务，也不能作为已退休数据库的降级程序。

主要代码入口见本文 `sources`，执行链回归见 [download-lane.postgres.test.ts](../../packages/pixishelf-job-executors/src/archive/__tests__/download-lane.postgres.test.ts)。测试结果、尚未覆盖项与环境证据只维护在[验证记录](../records/features/archive-partial-coverage-2026-10-29.md)。
