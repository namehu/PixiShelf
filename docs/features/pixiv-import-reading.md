---
status: current
scope: 指定账户的 Pixiv 新作品默认完成及历史维护工具退役
last-verified: 2026-11-04
sources:
  - packages/pixishelf-db/src/artwork-reading.ts
  - packages/pixishelf-job-executors/src/scan/pixiv-publisher.ts
  - packages/pixishelf/scripts/prepare-pixiv-reading-backfill.ts
---

# Pixiv 导入默认已读

适用场景：用户在下载 Pixiv 作品前已经阅读过，希望导入后不再显示未读。阅读规则统一见[作品阅读](./artwork-reading.md)。

- 账户偏好 `UserSetting.pixiv_import_mark_read`，仅 `type=boolean,value=true` 启用，默认关闭。
- 仅 Pixiv 扫描新建作品成功发布时应用，在同一事务中初始化非空作品的账户位置行并设 `completed=true`。跳过、刷新、来源补全、链接归档、本地导入及手动创建不触发。
- 逻辑总数沿用 APNG/视频分组，零媒体不默认完成；仅影响启用偏好的账户。
- 不增加阅读次数，不伪造真实阅读/活动日期、最远或最后位置。完成后普通追加仍保持完成；完整重建清空状态。
- 关闭偏好不撤销已有完成记录。Worker 必须配套阅读位置版本；数据库偏好不会让旧 Worker 自动理解新模型。

旧集合模型下的历史补齐及生产核验保留在[历史执行记录](../records/features/pixiv-import-reading.md)，不能作为当前位置模型的操作指令。`prepare-pixiv-reading-backfill.ts` 已退役并明确拒绝执行；旧计划、逐媒体 SQL、恢复脚本和旧 Worker 均不得对新表/封存表执行。当前位置迁移本身已经按用户确认保留旧完成状态，不需要重跑历史补齐。

新的批量历史标记若有明确业务需求，应另行指定账户、范围、位置版本和恢复依据；当前不提供替代维护工具。发布、封存证据和恢复统一按[位置迁移手册](../operations/runbooks/reading-position-migration.md)执行。既有生产记录只证明当时版本，当前位置版本生产状态见[本次记录](../records/features/artwork-reading-position-2026-11-04.md)。
