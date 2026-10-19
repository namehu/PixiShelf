---
status: current
scope: 归档回收站、来源删除状态、持久删除意图和重新归档
last-verified: 2026-10-12
sources:
  - packages/pixishelf/services/archive/archive-trash-service.ts
  - packages/pixishelf/services/archive-uploader/archive-uploader-catalog-state.ts
  - packages/pixishelf-job-executors/src/archive/deletion-policy.ts
  - packages/pixishelf-db/prisma/migrations/20261012160000_archive_deleted_identities/migration.sql
---

# 归档回收站

本文描述仓库实现；生产发布尚未核验。

## 用户行为

归档任务页默认隐藏已删除作品关联的历史任务，同页「回收站」Tab 使用 `tab=trash`，按作品聚合、按删除时间倒序分页，展示来源、删除时间、预计清理时间和维护状态。切换 Tab 重置分页和选中项。历史任务深链接仍可查阅，删除后的当前状态显示「已删除」，不改写任务曾经完成的事实。

回收站提供搜索、单项和批量恢复、维护重试；站内原站预览已退役，有来源任务 ID 时保留新标签“打开原站”，缺少任务 ID 时禁用；任务地址无效时由受保护跳转 Route 拒绝。外链统一使用 `noopener noreferrer` 与 `no-referrer`。恢复只有在 7 天保留期内且没有活动永久清理任务时才允许；批量操作每件作品独立事务、逐项报告并支持幂等重放。文件移动仍由 Worker 执行，恢复完成后才返回正常列表。到期尚未清理显示「等待清理」，不提供提前永久删除。清理重试仍受原有到期检查保护。

来源结果只增加「已删除」筛选与统一「已删除」状态，不提供回收站入口或恢复操作。「已归档」不含已删除作品，「全部」包含。保留期内没有重新归档按钮，永久清理后可以手动「重新归档」，强制进入 MANUAL 收件、解析、确认下载流程。新手动流程运行时显示实际进度；失败或取消保留删除记录，只有成功发布才解除删除意图。

## 数据与不变量

`archive_deleted_identities` 按 `providerKey + externalId` 保存作品 ID、来源地址、删除时间和永久清理时间，没有指向 Artwork 或发现来源的外键。因此作品、来源、收件和任务历史被清理后，删除意图依然有效。新来源再次扫描同一身份仍显示已删除。

`ArchiveImport.publishedArtworkDeletedAt/publishedArtworkPurgedAt` 保存该历史任务关联作品的删除事实。新作品重新归档成功不会清除此前旧任务的标记；原作品恢复才清除它关联任务的标记。缺少作品外键不能单独视为删除证据。

数据库触发器保证生命周期变化与这些记录在同一事务提交：

- `artwork_preserve_archive_deletion`：删除意图覆盖作品全部来源引用并标记关联任务；恢复 ACTIVE 且清除 deletedAt 时解除对应标记；真正删除 Artwork 前保存 purge 时间，此时 Worker 已完成文件删除。
- `archive_import_clear_published_deletion`：成功发布才解除该来源身份的删除标记，不改写旧任务历史。

自动收件对已知来源地址提前拒绝；其他 URL 在解析确认身份后跳过。自动入队、首次来源艺术家绑定也尊重删除意图。下载开始和发布前检查删除记录，禁止旧失败任务通过重试复活作品；永久清理后须使用新手动提交，任务/收件创建时间必须晚于 purge 时间。数据库时间和应用时间应正常同步。

## 管理接口

`archive.listTrash` 为管理员分页查询，输入 search、limit 和 `(deletedAt,id)` 游标，返回作品列表、总数、下一页游标及服务端操作资格。最多每页 100 件。

`archive.restoreTrash` 接受幂等键和最多 100 个作品 ID，复用批量操作账本（RESTORE_ARCHIVE / ARCHIVE_ARTWORK），按项提交既有维护任务。`archive.retryTrash` 仅提交既有删除、恢复或到期清理命令，不绕过状态和期限校验。

来源查询与计数增加 DELETED 分组，操作资格统一由服务端裁决。源页面不会暴露回收站维护动作。

## 发布与恢复

迁移为增量 migration `20261012160000_archive_deleted_identities`，回填现存软删除归档作品及其任务。上线前已永久清理且缺少明确证据的记录不猜测回填；它们不能获得追溯性的防重复下载保证。

Worker 启动门禁要求该 migration 已完成、持久删除表和两个任务历史列均存在；缺失时拒绝启动，避免领取任务后才因数据库结构不兼容失败。

按[备份与恢复](../operations/backup-and-recovery.md)停止所有写入者，记录数据库、媒体、配置和镜像的一致检查点，然后 generate、显式 migrate deploy，再协调启动新 App 和 Worker。禁止 db:push，禁止旧 Worker 与新生命周期实现混跑。新增删除表和历史字段必须随数据库备份保存；回退旧程序前停止自动归档和清理，旧程序不能保证尊重删除意图，也不能恢复已经永久清理的文件。需要撤销迁移时使用同一检查点整体恢复，不能删除新表代替业务恢复。

隔离 PostgreSQL 验证覆盖真实迁移链、跨来源删除标记、恢复、永久清理、来源重建、历史任务保留、计数与批量幂等；组件测试覆盖恢复反馈、搜索重置与到期状态。生产数据与媒体未用于测试。
