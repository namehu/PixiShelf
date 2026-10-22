---
status: current
scope: 任务注册、版本、lane 和领域实现的查找入口
last-verified: 2026-10-22
sources:
  - packages/pixishelf-worker/src/create-worker-executor-registry.ts
  - packages/pixishelf-worker/src/production-capabilities.ts
  - packages/pixishelf-worker/src/capability-audit.ts
  - packages/pixishelf/services/scheduled-task-registry.ts
---

# 后台任务参考

本文用于从业务找到代码与说明，不维护任务总数、版本组合数量或完整 payload 字典。新增任务时修改契约、注册表、执行器与相关领域说明；不要在多篇文档增加同一个数量。

## 精确事实来源

| 要查什么                     | 入口                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型、lane、状态和 payload   | [job-types.ts](../../packages/pixishelf-job-contracts/src/job-types.ts)、[payloads.ts](../../packages/pixishelf-job-contracts/src/payloads.ts) |
| 实际 Executor 注册及支持版本 | [create-worker-executor-registry.ts](../../packages/pixishelf-worker/src/create-worker-executor-registry.ts)                                   |
| 生产必须具备的能力集合       | [production-capabilities.ts](../../packages/pixishelf-worker/src/production-capabilities.ts)                                                   |
| 部署能力比较与命令行为       | [capability-audit.ts](../../packages/pixishelf-worker/src/capability-audit.ts)、[部署基线](../operations/deployment.md)                        |
| 计划默认启用、优先级和配置   | [scheduled-task-registry.ts](../../packages/pixishelf/services/scheduled-task-registry.ts)                                                     |
| claim、优先级、租约与围栏    | [queue-repository.ts](../../packages/pixishelf-job-runtime/src/queue-repository.ts)                                                            |

版本是同一任务类型的输入契约，不是另一类业务任务。Worker 只领取其 Registry 支持的类型/版本/lane 组合。注册能力也不等于开放新的用户入口：例如 `ARTWORK_SUMMARY_GENERATE` 保留历史任务执行和控制，但[堆叠浏览](../features/artwork-summary.md)已停止创建新的旧摘要任务。

## 业务导航

| 任务族                                             | 领域说明                                                                                                                                               | 执行代码目录                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `SCAN`、`LOCAL_DIRECTORY_IMPORT`                   | [来源维护](./source-maintenance.md)、[本地导入链路](./background-job-business-flows.md#本地目录导入链路)                                               | `job-executors/src/scan/`                                                |
| `ARCHIVE_RESOLVE_ITEM`、`ARCHIVE_IMPORT`、归档维护 | [收件箱](../features/archive-intake.md)、[生命周期](../features/archive-lifecycle.md)                                                                  | `job-executors/src/archive/`                                             |
| 上传者/标题扫描、批量发现、规则预览                | [发现来源](./archive-discovery.md)、[标题规则](../features/archive-title-rules.md)                                                                     | `job-executors/src/archive/`                                             |
| Pixiv 标签/艺术家补全、作品同步、系列核对          | [来源同步](../features/pixiv-artwork-online-sync.md)、[系列核对](../features/pixiv-series-sync.md)                                                     | `job-executors/src/pixiv-{tag,artist,artwork,series}/`                   |
| 创作者维护、艺术家合并、历史默认标签补全           | [创作者关系](../features/creator-relations.md)、[艺术家合并](../features/artist-merge.md)、[默认标签补全](../features/archive-default-tag-backfill.md) | 以 Registry 的 factory 为入口                                            |
| 动画识别、动图时长、派生标签和元数据维护           | [媒体处理](./media-processing.md)、[时长探测](./animation-duration-probe.md)                                                                           | `job-executors/src/maintenance/`                                         |
| 视频探测/封面/章节/代表帧/优化、派生 GC            | [媒体处理](./media-processing.md)                                                                                                                      | `job-executors/src/video-media/`、`video-processing/`、`video-keyframe/` |
| 迁移和待替换                                       | [媒体处理](./media-processing.md#迁移与批量替换)、[恢复基线](../operations/backup-and-recovery.md)                                                     | `job-executors/src/migration/`、`pending-replace/`                       |
| 事件、扫描、收件和触发器历史清理                   | 对应功能的保留政策和[执行机制](./background-jobs.md)                                                                                                   | 以 Registry 的 factory 为入口                                            |

表内 `job-executors` 为 `packages/pixishelf-job-executors` 的简写；精确文件由 Registry 追踪。
