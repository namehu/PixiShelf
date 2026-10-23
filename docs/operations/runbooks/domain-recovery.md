---
status: current
scope: 局部领域故障的保全、恢复单位与禁止操作
last-verified: 2026-10-22
sources:
  - packages/pixishelf/services/artwork-service/replace-write-lock.ts
  - packages/pixishelf/services/artwork-service/image-replace-session.ts
  - packages/pixishelf-job-executors/src
  - packages/pixishelf-db/prisma/schema.prisma
  - docs/operations/backup-and-recovery.md
---

# 领域恢复手册

先按[备份恢复基线](../backup-and-recovery.md)停写、保全现场和确定恢复点。本页只列领域差异，不授权跳过备份或直接改状态；无法证明局部修复完整时，使用同点完整集合恢复。

## 上传与替换中断

原媒体中的 `.replace-write-lock` 保护 App 分块、章节和替换文件写入。普通异常在流关闭后释放；进程崩溃或 NFS 卡住可能留下锁，后续请求最多等待 10 分钟后返回 `REPLACE_WRITE_LOCK_BUSY` / 409，不能按 mtime 自动夺锁。

1. 停止**所有** App 副本，确认旧写进程及文件流退出，同时停止可能直接改文件的 NAS 外部进程。
2. 备份现场；核对单个目录的 `owner.json`、原件、`.bak_session/.session-manifest.json` 和数据库 Image 记录。
3. 仅证实没有活跃写入后，才移除该目录中的**单个** `.replace-write-lock`；不得顺带删除 `.bak_session`。
4. manifest 与原件证据一致时按其阶段重试 init/rollback；`COMMITTING` 表示数据库可能提交也可能未提交，不能自动 rollback 或重复 commit。
5. manifest 缺失、损坏、旧版本没有 manifest 或证据不一致时，先结合数据库与同点媒体快照人工确认，不猜测原件/上传文件身份。

上传中断可能保留 `writeInProgress`、时长或摘要门禁；完成原上传或经核验恢复后处理，不能靠超时清门禁并重新显示旧 READY。相关模型见[动图时长](../../architecture/animation-duration-probe.md)。

## 作品与归档删除

- 本地作品删除直接删除选择的文件，不进系统回收站。执行前保存清单与快照；删除报告只保存在当次页面内存，应下载明细并保存报告 UUID。
- 文件删除失败时保留作品/媒体记录，重试会把已删文件计为缺失；数据库事务失败不恢复已经删除的文件。再次执行不是回滚，应用回退也不恢复文件。
- 下载失败从检查点复制校验恢复；发布失败只重试发布。清理已登记 generation 需要明确 drain，失联代须停写后离线核对，不能按租约过期盲删。详见[归档生命周期](../../features/archive-lifecycle.md#下载通道升级与恢复)。
- 归档回收、恢复、永久清理由专用维护流程与 writer lane 处理；不能手改父任务终态或直接移除领域记录。恢复已永久清理的来源应走新人工收件。
- 派生文件丢失时先核对发布 generation/路径/状态，再受控重建；不能把异时派生快照拼到当前数据库。

详见[作品删除](../../features/artwork-deletion.md)与[归档回收站](../../features/archive-trash.md)。

## 来源、创作者与补全

| 场景             | 恢复依据与限制                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 来源核对选定同步 | `SCAN@v3 / AUDIT_APPLY` 是领域写；数据库须同时保存父核对、apply ScanRun、逐项结果、Source Reference/Snapshot 与 inventory。取消须完成业务收口，媒体和发布结果同点 |
| 艺术家合并       | 包含 merge 审计、合并标记、创作者关系/证据、来源映射、发现绑定、待生效/抑制和触发器；不移动媒体，但不能仅还原 Artist 或清标记当成撤销                             |
| 创作者映射维护   | 可从执行记录生成恢复原映射的预览；取消只停止剩余项，不撤销已提交关系。旧 App 无法呈现新多作者结果                                                                 |
| AI 派生标签回填  | 预检只读；正式任务分批修改 provenance/派生关系。先保存数据库检查点与预检；兼容版本重试会跳过已完成或人工接管关系，不写反向脚本猜 provenance                       |
| 历史默认标签补全 | 保存冻结标签、作品上界、预览和任务 ID；取消保留已提交关系，重跑依唯一约束跳过。撤销用检查点，不能按标签 ID 反删可能已被人工继续使用的 MANUAL 关系                 |
| Pixiv 在线同步   | 数据库检查状态、不可变 metadata、同步报告属于同一发布语义；不得通过公开 Pixiv 图片路由取 JSON。文件成功但数据库失败时结合任务报告确认，不删除原件猜重跑           |

纯标签关系任务本身不修改媒体，可在确认其他写入者静默后使用该操作的数据库检查点恢复；此例外不能扩展到同时发生归档、替换或来源发布的窗口。详见[默认标签补全](../../features/archive-default-tag-backfill.md)、[艺术家合并](../../features/artist-merge.md)、[创作者关系](../../features/creator-relations.md)和[来源维护](../../architecture/source-maintenance.md)。

## Pixiv 根标记

原媒体快照必须保留隐藏 `.pixishelf-root` 并与数据库 inventory 的 `rootIdentity` 配对。首次绑定前保存旧标记、数据库检查点、实际挂载依据与 before/after 输出，不清空 inventory。

仅标记丢失时，核实仍为原图库且 Worker 停止后，可以恢复数据库原 UUID；标记不同或损坏先调查，不能覆盖。完整克隆保留同一个 UUID，不能靠 UUID 区分克隆。操作入口见[根身份](../../features/pixiv-root-identity.md)。

## 批量扫描与归档重试

批次状态、冻结来源顺序、游标、扫描目录和父子关系都在 PostgreSQL。重启依 fenced 事务/子任务检查点恢复，不得只把父任务改成终态。父任务基础设施失败后用失败来源重试或取消收口子扫描；回退应用前取消批次并等待子任务终止，不清来源游标、不删除已发现目录。

归档恢复应优先使用后台任务详情的重试入口，核对新任务绑定原归档、保留完成媒体及原质量。不要为恢复一次失败删除 staging 或重建归档。403 按诊断检查来源访问，509 等待来源额度恢复；`WORKER_LEASE_EXPIRED` 可能是 Worker 退出后的结果，必须查看更早错误。具体生产现场和证据限制见[2026-10-06 事件](../../records/operations/archive-retry-incident-2026-10-06.md)。

## 阅读与派生摘要

阅读表、Artwork `mediaRevision`、原媒体必须同点。完整替换/恢复/全量重建在媒体发布事务中递增版本并清空所有账户的该作品阅读；普通增删/排序保留存续媒体记录和访问次数。

兼容代码回退保留新增表/列，并暂停旧代码的完整重建、扫描及替换入口。旧代码若已重建媒体，保存受影响作品 ID；重新升级前逐项通过兼容事务清空相应阅读并递增版本。范围未知先审计修复，不能直接恢复阅读入口。新手动记录允许实际访问时间为空，不得伪造时间以满足旧版本。

`ArtworkSummary` / `ArtworkSummaryFeature` 是派生数据，但组阅读写入的 `artwork_read_media` 是用户记录；清除摘要不能撤销已读。详细语义见[阅读记录](../../features/artwork-reading.md)和[堆叠浏览](../../features/artwork-summary.md)。
