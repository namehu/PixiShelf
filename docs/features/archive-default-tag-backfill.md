---
status: current
scope: 历史 URL 归档作品的默认标签预览、补全、调度、取消和恢复边界
last-verified: 2026-08-28
sources:
  - packages/pixishelf/app/admin/setting/_components/archive-default-tag-backfill-control.tsx
  - packages/pixishelf/server/routers/setting.ts
  - packages/pixishelf/services/archive-default-tag-backfill-service.ts
  - packages/pixishelf-job-contracts/src/payloads.ts
  - packages/pixishelf-job-executors/src/maintenance/archive-default-tag-backfill.ts
---

# 历史归档默认标签补全

扫描管理的“扫描设置 → 系统设置 → 归档默认标签”提供“补全历史归档标签”。它用于把当前已经保存的归档默认标签追加到历史 URL 归档作品，不会删除任何原标签、改变来源字段、重新下载媒体或重新发布归档。

## 范围与冻结预览

候选作品必须同时满足：

- `createdVia=URL_ARCHIVE`；
- `deletedAt IS NULL`；
- `archiveLifecycleState=ACTIVE`。

打开确认弹窗时，服务端读取已保存的 `archive_default_tag_ids`，过滤已经不存在的标签，并计算候选作品数、已存在关系数和预计新增关系数。预览同时冻结标签 ID、当时最大的候选 Artwork ID、候选数和 SHA-256 摘要。点击确认时服务端重新计算；设置、候选或关系已经变化时拒绝旧摘要并要求重新预览。

冻结只限制本次历史集合。预览后新发布的归档作品 ID 高于本次上界，不进入本次任务；它们仍由 `ARCHIVE_IMPORT@v2` 使用发布时冻结的默认标签正常打标。

## 执行与并发

确认后创建全局单例 `ARCHIVE_DEFAULT_TAG_BACKFILL@v1`：

- 运行在 `BACKGROUND_WRITER`，手动优先级为 99；
- 每批最多检查 100 个 Artwork，按 ID 游标推进；
- 每批的 `ArtworkTag` 写入和 `SystemJob.result` 检查点在同一个 fenced 数据库事务中提交；
- 尚有候选时进入短暂 `RETRY_WAIT`，保留 attempt，并在约 1 秒后重新参与领取；
- 归档导入等更高优先级 writer 任务可以在批次之间先执行。

同一时刻只允许一个该类型活动任务。重复点击不会创建并行任务，而是展示当前任务。页面内显示进度、已检查作品、已新增和已存在关系，并可跳转后台任务页。

## 标签关系语义

补全只执行追加：

- 每个仍存在的冻结标签与每个候选作品尝试建立关系；
- 新关系的 provenance 为 `MANUAL`；
- `(artworkId, tagId)` 唯一约束和 `createMany(skipDuplicates)` 保证重复运行幂等；
- 已存在的 SOURCE、DERIVED、LEGACY 或 MANUAL 关系都保留，不改 provenance；
- 执行期间已删除的冻结标签记录为跳过，不自动重建；
- 任务不修改标签统计缓存，既有标签统计维护流程仍是统计事实的重建入口。

完成结果记录目标作品、已检查作品、新增关系、已存在关系、跳过作品、失败作品和已跳过标签 ID。当前执行器按批次原子处理，单作品没有可继续的软失败分支，因此 `failedArtworks` 正常为 0；数据库或围栏错误会让整个任务按队列策略重试或失败。

## 取消、重跑与恢复

取消在批次边界生效，已经提交的标签关系不回滚。调整默认标签后可以重新预览并再次运行；已存在关系会被幂等跳过。任务本身不提供反向删除，因为后续人工操作可能继续使用相同的 `MANUAL` 关系。

预览不写数据库。正式运行属于批量领域关系写入，执行前应按[备份与恢复基线](../operations/backup-and-recovery.md)创建 PostgreSQL 一致性检查点并记录预览摘要和任务 ID。若必须完整撤销已提交批次，应恢复该数据库检查点；本任务不修改媒体文件，不要求单独回滚媒体目录。

## 权限与可用性

状态读取使用 `authProcedure`，预览、创建和取消使用 `adminProcedure`。当前单一信任域中二者运行能力相同，但写入口保留管理员语义。没有有效默认标签、设置仍在保存、中央调度未启用，或没有报告该 job type、v1 和 writer lane 的新鲜 READY Worker 时，页面不会允许启动任务。

相关文档：

- [归档收件箱](./archive-intake.md)
- [后台任务业务链路](../architecture/background-job-business-flows.md)
- [权限与接口边界](../security/access-control.md)
- [部署基线](../operations/deployment.md)
