# PixiShelf 文档索引

本文是 PixiShelf 文档的统一入口。它负责说明每份文档的权威范围和状态；代码、Schema、Compose 与环境变量模板仍是精确结构和配置的最终事实源。

最后核验：2026-08-20（视频探测与封面生成工作流）

## 状态约定

| 状态         | 含义                             | 使用规则               |
| ------------ | -------------------------------- | ---------------------- |
| `current`    | 已按当前代码或运行配置核验       | 可以作为实施和操作依据 |
| `draft`      | 已确认方向，但尚未全部实施或核验 | 不得当成当前行为       |
| `historical` | 一次性实施记录或已经退役的方案   | 只用于理解演进过程     |
| `deprecated` | 内容不完整、重复或可能误导       | 等待合并、归档或删除   |

ADR 使用独立状态：`proposed`、`accepted`、`superseded`。

## 事实来源顺序

发生冲突时按问题类型判断，而不是让某一篇文档覆盖全部事实：

1. 产品范围、非目标与验收标准：产品基线或功能规格。
2. 已上线系统的组件边界和数据流：当前架构与实际代码。
3. 精确字段、类型和配置：Prisma Schema、Zod、TypeScript、Compose 与 `.env.example`。
4. 技术选择的原因和代价：已接受 ADR。
5. 部署、备份、恢复和故障操作：`current` 运维文档。
6. 未来设计：`draft` 文档；不得覆盖当前事实。

发现 `current` 文档与实现冲突时，应先停止依赖该段内容，核验代码和运行配置，并在同一变更中修正文档。

## 核心入口

| 文档                                               | 状态      | 权威范围                                    |
| -------------------------------------------------- | --------- | ------------------------------------------- |
| [项目 README](../README.md)                        | `current` | 项目入口、标准本地启动、常用命令            |
| [产品基线](./product/product-baseline.md)          | `current` | 目标用户、核心场景、产品不变量和非目标      |
| [归档收件箱](./features/archive-intake.md)         | `current` | 持久收件、双通道、批量操作、维护和保留策略  |
| [领域语境](../CONTEXT.md)                          | `current` | 作品、媒体、来源、归档与本地身份术语        |
| [当前架构](./architecture/current-architecture.md) | `current` | Workspace、运行组件、依赖方向和关键数据流   |
| [权限与接口边界](./security/access-control.md)     | `current` | 调用者、页面、API、服务、凭据和存储权限     |
| [测试策略](./development/testing-strategy.md)      | `current` | 测试分层、变更验证矩阵、CI 覆盖与已知缺口   |
| [部署基线](./operations/deployment.md)             | `current` | 当前 Compose 服务、升级顺序、验证和回滚入口 |
| [备份与恢复](./operations/backup-and-recovery.md)  | `current` | 完整备份集合、恢复目标、演练和灾难恢复边界  |
| [Build 与部署资产](../build/README.md)             | `current` | Dockerfile、Compose、挂载和 Worker 运行边界 |
| [当前待办](../TODO.md)                             | `current` | 稳定观察期和下一阶段可执行事项              |
| [代理规则](../agents.md)                           | `current` | 人与 AI 修改仓库时必须遵守的工程约束        |

## 架构与性能

| 文档                                                                              | 状态         | 权威范围与后续处理                                     |
| --------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------ |
| [当前架构](./architecture/current-architecture.md)                                | `current`    | 当前系统级事实源                                       |
| [媒体资源处理与分发](../packages/pixishelf/docs/media-forwarding-architecture.md) | `current`    | ImgProxy、静态派生媒体和视频播放边界；后续移入架构目录 |
| [数据库设计补充](../packages/pixishelf-db/prisma/database-design.md)              | `current`    | Schema 之外的触发器、索引和维护约束                    |
| [Artwork feed 查询性能](./design/artwork-feed-query-performance.md)               | `current`    | 2026-08-12 数据集上的性能基线和回归门禁                |
| [旧版常用 SQL](./SQL.md)                                                          | `deprecated` | 零散历史查询，不作为数据库操作或运维手册               |
| [后台任务架构设计](./design/background-task-architecture.md)                      | `historical` | Central Dispatcher 切换设计，混合了当时现状与目标      |
| [后台任务数据模型](./design/background-task-data-model.md)                        | `historical` | 切换期模型、兼容字段和迁移顺序；当前字段以 Schema 为准 |
| [后台任务实施与运行手册](./design/background-task-runbook.md)                     | `historical` | 阶段 0–8 实施与切换手册；当前操作以运维文档为准        |
| [后台扫描任务化设计](./design/background-scan-jobs.md)                            | `historical` | 扫描任务化实施方案，不作为当前接口说明                 |
| [扫描与导入审计历史](./design/scan-audit-history.md)                              | `historical` | 已实施阶段和历史限制                                   |

## 功能规格、草案与实施归档

| 文档                                                     | 状态         | 权威范围与后续处理                                         |
| -------------------------------------------------------- | ------------ | ---------------------------------------------------------- |
| [归档收件箱](./features/archive-intake.md)               | `current`    | 当前持续追加、持久解析、批量入队、双通道和维护边界         |
| [归档收件队列设计](./design/archive-intake-queue.md)     | `historical` | 已实施的需求取舍、实施切片和验收设计                       |
| [多来源 URL 归档](./design/multi-source-url-archive.md)  | `draft`      | 已接受方向与分阶段设计；需按实现核验后提炼当前架构         |
| [视频代表帧生成](./design/video-keyframe-generation.md)  | `draft`      | 已接受功能政策和实施设计，正文仍包含迁移期信息             |
| [界面设计升级计划](./pixishelf-design-upgrade-plan.md)   | `draft`      | 分阶段 UI 升级计划，不改变当前业务契约                     |
| [媒体类型建模技术债](../todos/媒体类型后缀匹配技术债.md) | `draft`      | 媒体类型结构化的待实施方案，后续迁入 `docs/features/`      |
| [PixiShelf 优化 TODO](../todos/PixiShelf优化TODO.md)     | `draft`      | 优化候选集合；执行项应逐步收敛到根 TODO 或功能规格         |
| `todos/多媒体设计.md`（已删除）                          | `deprecated` | 对话式建议且包含旧路径；2026-08-18 清理，历史可从 Git 追溯 |

## ADR

| 文档                                                                          | 状态       | 决策范围                         |
| ----------------------------------------------------------------------------- | ---------- | -------------------------------- |
| [ADR-0001](./adr/0001-separate-source-references-from-local-identity.md)      | `accepted` | 外部来源引用与本地作品身份分离   |
| [ADR-0002](./adr/0002-use-a-durable-worker-and-atomic-archive-publication.md) | `accepted` | 持久 Worker 与原子归档发布       |
| [ADR-0003](./adr/0003-unify-background-jobs-under-a-durable-single-worker.md) | `accepted` | PostgreSQL 队列上的单通用 Worker |
| [ADR-0004](./adr/0004-run-archive-resolution-in-a-separate-worker-lane.md)    | `accepted` | 单 Worker 内双资源执行通道       |

## 部署、发布与历史记录

| 文档                                                                    | 状态         | 权威范围与后续处理                                  |
| ----------------------------------------------------------------------- | ------------ | --------------------------------------------------- |
| [部署基线](./operations/deployment.md)                                  | `current`    | 当前标准部署和升级入口                              |
| [备份与恢复](./operations/backup-and-recovery.md)                       | `current`    | 完整备份集合、验证演练与灾难恢复边界                |
| [后台任务回滚手册](./deployment/background-task-cutover-rollback.md)    | `historical` | 已退役旧消费者兼容期的回滚手册                      |
| [后台任务上线后续](./deployment/background-task-follow-up.md)           | `historical` | 2026-08 阶段 8 前的稳定观察与清理清单               |
| [后台任务切换记录](./deployment/background-task-cutover-deployment.md)  | `historical` | 2026-08 阶段 1–7 切换记录                           |
| [归档收件箱切换记录](./deployment/archive-intake-cutover-deployment.md) | `historical` | 双通道迁移、审计、检查点与发布证据登记              |
| [旧版系统设计](./archive/system-design-legacy.md)                       | `historical` | 已退役的 `src/` 目录与单应用三层模型                |
| [旧版部署指南](./archive/deployment-legacy.md)                          | `historical` | 已退役的 Vite、`packages/web` 和 API/Web 双镜像流程 |
| [旧版调度架构](./archive/scheduler-architecture-legacy.md)              | `historical` | Central Dispatcher 切换前的进程内执行路径           |

旧路径 `DEPLOYMENT.md`、`docs/SYSTEM_DESIGN.md` 和 `docs/SCHEDULER_ARCHITECTURE.md` 只保留短跳转页，用于兼容外部链接；它们不是独立事实源。

## 包与工具文档

| 文档                                                                      | 状态         | 说明                                           |
| ------------------------------------------------------------------------- | ------------ | ---------------------------------------------- |
| [主应用包说明](../packages/pixishelf/readme.md)                           | `current`    | 主应用边界和包级命令；项目启动以根 README 为准 |
| [Webhook 扫描](../packages/pixishelf/docs/webhook-features.md)            | `current`    | 扫描 Webhook 负载契约；权限边界以安全矩阵为准  |
| [ProTable](../packages/pixishelf/components/shared/pro-table/readme.md)   | `current`    | 共置组件使用说明                               |
| [Pixiv 信息提取脚本](../packages/pixishelf/scripts/extract-pixiv-info.md) | `current`    | 共置脚本输入、输出与用法                       |
| [浏览器扩展](../packages/pixishelf-extension/README.md)                   | `deprecated` | 当前仍是 WXT 模板，后续需要重写                |
| [独立扫描器](../packages/pixiv-standalone-scanner/README.md)              | `draft`      | 基本用法存在，尚未核验完整支持边界             |
| [Zip Convert](../packages/zip-convert/README.md)                          | `draft`      | 工具用法存在，尚未核验测试与平台边界           |
| [辅助脚本](../scripts/README.md)                                          | `draft`      | 使用前需核验脚本、参数和基准数据               |

## 文档维护门禁

以下变更必须在同一工作项中评估并更新相关文档：

- 产品范围、核心用户流程或非目标发生变化；
- 新增或改变跨 workspace/package 依赖；
- 修改数据库语义、迁移、数据生命周期或删除恢复规则；
- 修改认证、权限、外部 API 或内部令牌边界；
- 修改 Compose、环境变量、挂载、备份或恢复流程；
- 引入难以逆转的技术选择；
- 事故修复产生新的诊断、恢复或预防规则。

普通样式调整、局部重构和行为明确的小修复不要求创建设计文档。功能规格只在跨包、涉及迁移/回滚、包含异步并发，或验收标准无法在短 TODO 中说明时创建。
