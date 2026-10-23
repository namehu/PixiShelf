# 发布、验证与实验记录

这些记录保存特定日期、版本、环境与样本下的证据，不能代替[当前文档](../README.md)。历史记录中的“已发布”“通过”“当前”只对当时验证范围成立；未归档原始输出或未登记镜像 digest 的限制继续保留。

开发方向与决策：[2026-10-22 开发重点审查与首批实施决定](./development-priorities-2026-10-22.md)。

## 功能与用户流程

完整清单见[功能记录索引](./features/README.md)。下表提供跨领域常用入口。

| 主题               | 记录                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 归档发现与标题规则 | [收件箱](./features/archive-intake.md)、[标题规则](./features/archive-title-rules.md)                                                                                                    |
| 阅读、浏览与进度   | [阅读](./features/artwork-reading.md)、[自动浏览](./features/artwork-auto-browse.md)、[沉浸交互](./features/immersive-viewer-interactions.md)、[堆叠浏览](./features/artwork-summary.md) |
| 筛选与隐私         | [快捷筛选](./features/artwork-quick-filters.md)、[浏览器隐私](./features/browser-privacy.md)                                                                                             |
| 来源与整理         | [Pixiv 默认已读与回填](./features/pixiv-import-reading.md)、[扫描根身份](./features/pixiv-root-identity.md)、[系列管理](./features/series-management.md)                                 |
| 任务与删除         | [失败诊断](./features/background-job-diagnostics.md)、[实时进度](./features/background-job-live-progress.md)、[作品删除](./features/artwork-deletion.md)                                 |

## 架构与性能验证

归档下载独立通道：[2026-10-23 实施验证](./archive-download-lane-2026-10-23.md)。

| 主题       | 记录                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WebP 播放  | [流式播放器验证](./architecture/webp-streaming-verification.md)、[手机性能与生产接入验证](./architecture/webp-mobile-verification.md)                                                      |
| 时长探测   | [隔离验证与限制](./architecture/animation-duration-verification.md)                                                                                                                        |
| 数据库演进 | [迁移背景与历史约束](./architecture/database-migration-history.md)                                                                                                                         |
| 查询性能   | [作品 feed](./architecture/artwork-feed-query-performance.md)、[发现来源](./architecture/archive-discovery-query-performance.md)、[统计页](./architecture/statistics-query-performance.md) |

## 发布、迁移与事故

| 主题             | 记录                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 后台任务切换     | [阶段 1–7](./operations/background-task-cutover-deployment.md)、[后续观察](./operations/background-task-follow-up.md)、[当时的兼容回滚](./operations/background-task-cutover-rollback.md) |
| 双通道收件箱     | [切换记录](./operations/archive-intake-cutover-deployment.md)                                                                                                                             |
| 下载独立通道     | [2026-10-23 本地升级与就绪检查](./operations/archive-download-lane-local-upgrade-2026-10-23.md)                                                                                           |
| 后台任务兼容退役 | [2026-10 发布确认与证据缺口](./operations/background-task-retirement-2026-10.md)                                                                                                          |
| 阅读迁移         | [2026-09-24 隔离数据库验证](./operations/reading-migration-2026-09-24.md)                                                                                                                 |
| 归档事故         | [2026-10-06 重试事件](./operations/archive-retry-incident-2026-10-06.md)                                                                                                                  |
| WebP CI 回归     | [2026-10-17 初始化时序](./operations/webp-ci-regression-2026-10-17.md)                                                                                                                    |
| 文档治理         | [2026-10-22 文档重整与去向](./documentation-reorganization-2026-10-22.md)                                                                                                                 |

操作前回到[当前部署](../operations/deployment.md)和[备份与恢复](../operations/backup-and-recovery.md)，不要直接照抄历史操作命令。新增证据按[文档维护](../development/documentation.md)记录适用版本、环境和限制。

- [作品去重分阶段开发记录](./artwork-deduplication-2026-10-23.md)：独立 worktree 基线与阶段验收证据。

- [去重第一阶段代码与隔离验证](./artwork-deduplication-phase-1-2026-10-23.md)，附 [App 上传与替换交接](./artwork-deduplication-phase-1-app-handoff-2026-10-23.md)。

- [去重第二阶段后台检测与资源验证](./artwork-deduplication-phase-2-2026-10-23.md)：模块验证、独立审查和 50 万媒体性能记录。

- [去重第三至第五阶段并行实施调整](./artwork-deduplication-parallel-2026-10-24.md)：职责、共享契约、分批审查与性能环境隔离。
