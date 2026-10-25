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

去重本版：[2026-10-25 版本收口与 NAS 发布交接](./operations/artwork-deduplication-release-2026-10-25.md)，附[疑似版本本地升级](./operations/artwork-deduplication-visual-local-upgrade-2026-10-25.md)。

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

- [去重开发80%额度停工交接](./artwork-deduplication-pause-2026-10-24.md)：最终未提交范围、各线审查状态、隔离环境、剩余工作和恢复步骤。
- [去重开发收口与续接检查点](./artwork-deduplication-checkpoint-2026-10-24.md)：当前基线、未完成范围、验证环境与额度恢复后的续接顺序。

- [去重第三阶段串联与门禁](./artwork-deduplication-stage-3-integration-2026-10-24.md)，附[数据审查](./artwork-deduplication-stage-3-data-review-2026-10-24.md)、[编排审查](./artwork-deduplication-orchestration-review-2026-10-24.md)。

- [去重PREPARE规模验证](./artwork-deduplication-prepare-scale-2026-10-24.md)与[完整性查询修复](./artwork-deduplication-prepare-query-2026-10-24.md)：区分真实读取窗口与SQL-only五十万清单证据。

- [去重归属复核有界回写](./artwork-deduplication-prepare-ownership-2026-10-24.md)与[第四阶段声明基础](./artwork-deduplication-claims-foundation-2026-10-24.md)：性能修复、事务互斥与当前接入范围。

- [声明基础审查](./artwork-deduplication-claims-review-2026-10-24.md)、[App个人守卫实现](./artwork-deduplication-app-personal-guards-2026-10-24.md)与[独立审查](./artwork-deduplication-app-personal-guards-review-2026-10-24.md)。

- [去重来源证明与写入口盘点](./artwork-deduplication-write-entry-map-2026-10-24.md)：下一批持久快照、旧任务处理、归档drain和回收保护的待实施契约。
- [去重App元数据与排序守卫](./artwork-deduplication-app-structure-guards-2026-10-24.md)：两个纯数据库写入口的守卫与定向验证。
- [去重App元数据与排序守卫独立审查](./artwork-deduplication-app-structure-guards-review-2026-10-24.md)：锁序、分支与排序CAS复核。
- [去重来源证明持久槽](./artwork-deduplication-source-snapshot-2026-10-24.md)：正式111五个可空槽、严格格式、无损迁移与兼容门槛证据。
- [去重来源证明持久槽独立审查](./artwork-deduplication-source-snapshot-review-2026-10-24.md)：迁移兼容P2修复复核，生产接线尚未实施。
- [去重批量来源证明](./artwork-deduplication-source-groups-2026-10-24.md)：统一捕获/断言、集合锁顺序及 PostgreSQL 专项验证。
- [去重批量来源证明独立审查](./artwork-deduplication-source-groups-review-2026-10-24.md)：路径重叠查询的性能问题及修复复核状态。
- [去重 App 输入证明](./artwork-deduplication-app-input-proofs-2026-10-24.md)：导入、重扫、审计应用与 URL 意图冻结和重试保护。
- [去重扫描来源接线](./artwork-deduplication-scan-sources-2026-10-24.md)：冻结输入、增量无变化回执及扫描/审计发布的原证明校验。
- [去重 App 输入证明独立审查](./artwork-deduplication-app-input-proofs-review-2026-10-24.md)：来源冲突错误提示的 P2 及修复复核状态。
- [去重扫描接线独立审查](./artwork-deduplication-scan-sources-review-2026-10-24.md)：隐含catalog锁序问题与测试注入证据缺口，未通过。
- [去重归档接线暂停交接](./artwork-deduplication-archive-sources-pause-2026-10-24.md)：归档原证明链的已测范围和未完成事项。
- [去重App媒体守卫WIP](./artwork-deduplication-app-media-guards-wip-2026-10-24.md)：媒体/章节注册和手工存储的未审改动。
- [去重再次暂停交接](./artwork-deduplication-resume-pause-2026-10-24.md)：用户额度控制要求下的最终状态与续接入口。

- [去重直接删除方案调整与文档验证](./artwork-deduplication-direct-delete-plan-2026-10-24.md)：替代隔离/恢复方案、三批暂停门槛及本轮文档范围；新删除未实现验收。

- [去重直接删除第一批及审查](./artwork-deduplication-direct-delete-batch1-2026-10-24.md)：必要写保护与第一批完成证据。
- [去重直接删除第二批完成与暂停交接](./artwork-deduplication-direct-delete-batch2-2026-10-24.md)：四来源后端、正式迁移、专项验证及第三批续接入口；删除能力保持关闭。
- [去重直接删除第二批独立审查](./artwork-deduplication-direct-delete-batch2-review-2026-10-24.md)：P2-01修复差异复审通过，第二批完成。

- [去重直接删除第三批页面与最终验收](./artwork-deduplication-direct-delete-batch3-2026-10-24.md)：正式 UI、候选授权、最终一次全量检查与定向修复证据。
- [去重直接删除第三批独立审查](./artwork-deduplication-direct-delete-batch3-review-2026-10-24.md)：隐私遮蔽及审核分页 P2 已修复复审，代码门槛通过。

- [去重直接删除第三批浏览器验收](./artwork-deduplication-direct-delete-batch3-browser-2026-10-24.md)：真实四来源删除、分页、隐私、窄屏和账户切换；明确未覆盖项及截图导出限制。

- [去重分支合入主目录](./artwork-deduplication-main-merge-2026-10-24.md)：主线114文件保留核对、冲突解决、增量测试和本地启动测试命令。

- [去重本地开发数据库与Worker升级](./operations/artwork-deduplication-local-upgrade-2026-10-24.md)：正式迁移101→115、完整本地检查点与隔离恢复校验、Worker就绪；App由用户F5启动。
