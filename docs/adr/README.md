# 架构决策

ADR 保存作出选择时的上下文、备选方案与代价。正文中的当时数量、兼容字段和阶段状态不随实现迭代重写；当前机制应读[架构总览](../architecture/current-architecture.md)。`accepted` 表示决策被接受，不证明所有条款至今未被后续决策修订。

| 决策                                                                                             | 保留的核心                                                 | 后续修订与实现                                                                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [0001 来源引用与本地身份分离](./0001-separate-source-references-from-local-identity.md)          | 远端身份不决定本地作品身份                                 | [领域语境](../../CONTEXT.md)                                                                          |
| [0002 持久 Worker 与原子归档发布](./0002-use-a-durable-worker-and-atomic-archive-publication.md) | staging 验证、不可变 revision、fenced 发布与可恢复生命周期 | 0003 统一执行容器和队列，0004 调整资源通道；0008 独立下载通道与 writer 并行。                         |
| [0003 单通用 Worker](./0003-unify-background-jobs-under-a-durable-single-worker.md)              | PostgreSQL 队列、控制面/执行面分离、执行围栏               | 0004 将整个进程单执行槽修订为两条 lane；[当前机制](../architecture/background-jobs.md)。              |
| [0004 解析独立 lane](./0004-run-archive-resolution-in-a-separate-worker-lane.md)                 | 同一进程内解析与写入各并发 1                               | 0008 将下载拆到独立 lane；0006 修订归档内部媒体并发；解析 lane 当前类型范围查 Registry。              |
| [0005 退役破坏性全量重扫](./0005-retire-destructive-full-rescan.md)                              | 发现、来源刷新和一致性核对分工                             | [来源维护](../architecture/source-maintenance.md)、[扫描根身份](../features/pixiv-root-identity.md)。 |
| [0006 冻结媒体下载并发](./0006-freeze-database-configured-archive-media-concurrency.md)          | 数据库配置在执行开始冻结，同时约束下载与 governor          | 不增加 writer 执行槽；[归档链路](../architecture/background-job-business-flows.md#url-归档链路)。     |
| [0007 持久游标 SSE](./0007-stream-worker-job-events-over-a-persistent-cursor.md)                 | 事件表负责重放，共享订阅不另造消息真值                     | [实时进度](../features/background-job-live-progress.md)。                                             |

| [0008 下载与发布分阶段](./0008-separate-archive-download-and-publication.md) | 独立下载 lane、generation 隔离与 fenced 原子交接 | [归档生命周期](../features/archive-lifecycle.md)。 |

后台切换开关、旧任务列和计划时间字段的退役属于已记录决策的后续实施，见[退役规格](../features/background-task-retirement.md)及正式 migrations。不要因历史 ADR 仍描述兼容期而重新引入旧执行分支。
