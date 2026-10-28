# 架构与流程图导航

先选要回答的问题，再打开所属正文。图片用于阅读，`.mmd` 是唯一编辑源；同一规则不在不同文档各画一份。

## 系统与领域

| 问题                                     | 图                                                                                                                  | 权威正文                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 谁运行在哪里，数据流向哪里？             | [系统组件](./architecture/system-components.svg) · [源](./architecture/system-components.mmd)                       | [当前架构](../architecture/current-architecture.md) |
| 哪些包允许相互依赖？                     | [包依赖](./architecture/package-dependencies.svg) · [源](./architecture/package-dependencies.mmd)                   | [当前架构](../architecture/current-architecture.md) |
| 作品、媒体、来源、创作者、系列如何关联？ | [领域 UML](./features/domain-model.svg) · [源](./features/domain-model.mmd)                                         | [领域术语](../../CONTEXT.md)                        |
| 网络、会话与存储的权限在哪里？           | [部署与信任边界](./operations/deployment-trust-boundaries.svg) · [源](./operations/deployment-trust-boundaries.mmd) | [权限边界](../security/access-control.md)           |

## 业务与后台执行

| 问题                               | 图                                                                                                        | 权威正文                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| URL 怎样成为可浏览的本地作品？     | [归档泳道](./features/archive-flow.svg) · [源](./features/archive-flow.mmd)                               | [收件箱](../features/archive-intake.md)                  |
| 来源刷新怎样保护人工整理？         | [来源同步泳道](./features/source-sync.svg) · [源](./features/source-sync.mmd)                             | [来源在线同步](../features/pixiv-artwork-online-sync.md) |
| 核对何时变为显式写入？             | [Pixiv 核对与选定同步](./architecture/pixiv-audit-apply.svg) · [源](./architecture/pixiv-audit-apply.mmd) | [来源维护](../architecture/source-maintenance.md)        |
| 删除、恢复和重新归档如何衔接？     | [归档生命周期](./features/archive-deletion.svg) · [源](./features/archive-deletion.mmd)                   | [回收站](../features/archive-trash.md)                   |
| 任务可以怎样改变状态？             | [状态图](./architecture/job-lifecycle.svg) · [源](./architecture/job-lifecycle.mmd)                       | [执行机制](../architecture/background-jobs.md)           |
| 旧执行器为什么不能继续提交？       | [领取与执行围栏时序](./architecture/job-claim-fence.svg) · [源](./architecture/job-claim-fence.mmd)       | [执行机制](../architecture/background-jobs.md)           |
| 扫描、导入与视频任务具体怎样完成？ | [业务链路及专项图](../architecture/background-job-business-flows.md)                                      | 同左                                                     |

## 阅读、播放与恢复

| 问题                                       | 图                                                                                                                                                                                               | 权威正文                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 阅读观察怎样安全持久化？                   | [阅读事件时序](./architecture/reading-events.svg) · [源](./architecture/reading-events.mmd)                                                                                                      | [阅读架构](../architecture/reading.md)                        |
| 图片缩略图、视频和 WebP 各走哪条读取路径？ | [媒体读取时序](./architecture/media-read.svg) · [源](./architecture/media-read.mmd)                                                                                                              | [媒体分发](../architecture/media-delivery.md)                 |
| WebP 播放、回退和释放怎样协作？            | [类图](./architecture/webp-streaming-player/classes.svg)、[时序图](./architecture/webp-streaming-player/sequence.svg)、[状态图](./architecture/webp-streaming-player/states.svg)                 | [WebP 播放器与图源](../architecture/webp-player.md)           |
| 时长怎样探测并随源版本失效？               | [组件](./architecture/animation-duration-probe/components.svg)、[时序](./architecture/animation-duration-probe/sequence.svg)、[数据关系](./architecture/animation-duration-probe/data-model.svg) | [时长探测与图源](../architecture/animation-duration-probe.md) |
| 发布各阶段由谁负责？                       | [发布泳道](./operations/standard-release.svg) · [源](./operations/standard-release.mmd)                                                                                                          | [部署基线](../operations/deployment.md)                       |
| 故障应该重启、前向修复还是整体恢复？       | [恢复决策](./operations/recovery-decision.svg) · [源](./operations/recovery-decision.mmd)                                                                                                        | [备份与恢复](../operations/backup-and-recovery.md)            |

## 同艺术家作品去重

当前行为和全部图的阅读顺序见[功能规格](../features/artwork-deduplication.md)，历史总计划保留在[设计记录](../design/artwork-deduplication.md)。图描述已实现流程，不证明某个实例已经部署。

| 要回答的问题                                      | 图与源                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 用户怎样从检查走到确认删除？                      | [完整业务流程](./features/artwork-deduplication/business-flow.svg) · [源](./features/artwork-deduplication/business-flow.mmd)     |
| App、数据库、三条 Worker 通道与子进程分别做什么？ | [系统职责](./features/artwork-deduplication/architecture.svg) · [源](./features/artwork-deduplication/architecture.mmd)           |
| 三层缓存命中后还要做什么？                        | [检测与缓存](./features/artwork-deduplication/detection.svg) · [源](./features/artwork-deduplication/detection.mmd)               |
| 正常让行、暂停和硬上限有什么区别？                | [处理上限](./features/artwork-deduplication/processing-limits.svg) · [源](./features/artwork-deduplication/processing-limits.mmd) |
| 删除前后何时可以取消或停止？                      | [业务状态](./features/artwork-deduplication/lifecycle.svg) · [源](./features/artwork-deduplication/lifecycle.mmd)                 |
| 删除中断后怎样只续原范围？                        | [故障续行](./features/artwork-deduplication/recovery.svg) · [源](./features/artwork-deduplication/recovery.mmd)                   |

## 更新与检查

```bash
pnpm docs:diagrams
pnpm docs:diagrams:check
pnpm docs:check
```

统一渲染器复用已有 Mermaid/Playwright 依赖；图源变更后提交对应 SVG。SVG 带有源哈希，检查模式可发现未更新的图片。历史文档中的内嵌 Mermaid 保持历史语义，仅检查语法，不作为当前架构图。具体维护要求见[文档维护](../development/documentation.md)。
