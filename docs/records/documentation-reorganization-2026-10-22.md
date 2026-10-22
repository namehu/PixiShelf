---
status: historical
scope: 2026-10-22 文档重整范围、内容去向和验证依据
date: 2026-10-22
baseline: c94a46ff17b039be278c373d9810ede55353a583
---

# 文档重整记录

本次工作面向维护者与 AI 开发协作。基线为上列提交；工作开始时 Git 工作区干净。只修改文档、图源/生成 SVG、文档工具和读取文档的聚焦测试，不改变产品行为、数据库、迁移或部署配置。

## 组织方式

主代理维护入口、待办、文档约定、图示工具与最终检查；三个子 agent 分别负责产品功能、技术架构、安全运维。按文件归属并行编写，跨域依据在汇总时核对。

当前规则留在产品、领域规格、架构和运维正文；具体实验、验收、上线确认及事故现场移入 records；退役方案移入 archive。原入口被外部或历史文档引用时保留短跳转，不维护第二份全文。

## 主要去向

| 原内容                           | 当前规则入口                                                                                                                                                                | 历史或证据去向                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 重复文档清单                     | [统一入口](../README.md)、[功能目录](../features/README.md)、[图示导航](../diagrams/README.md)                                                                              | 原清单可从基线 Git 追溯                                                                                                 |
| 产品基线的实现细节               | [产品基线](../product/product-baseline.md)只保留能力和不变量，细节由对应功能/架构负责                                                                                       | 不复制整篇旧基线                                                                                                        |
| 归档收件箱大文                   | [发现来源](../features/archive-discovery.md)、[收件箱](../features/archive-intake.md)、[生命周期](../features/archive-lifecycle.md)、[回收站](../features/archive-trash.md) | [功能记录](./features/archive-intake.md)                                                                                |
| 功能中的按日期验收段             | 原功能路径保留当前规则和验收条件                                                                                                                                            | [功能记录索引](./features/README.md)                                                                                    |
| 后台任务架构与业务大文           | [执行机制](../architecture/background-jobs.md)、[任务参考](../architecture/background-job-reference.md)、[领域链路](../architecture/background-job-business-flows.md)       | [历史设计索引](../archive/README.md)                                                                                    |
| 阅读设计稿                       | [阅读架构](../architecture/reading.md)、[阅读规格](../features/artwork-reading.md)                                                                                          | [阅读验收](./features/artwork-reading.md)、[迁移验证](./operations/reading-migration-2026-09-24.md)                     |
| WebP 架构与生产接入混合材料      | [WebP 播放器](../architecture/webp-player.md)                                                                                                                               | [流式验证](./architecture/webp-streaming-verification.md)、[手机与生产接入](./architecture/webp-mobile-verification.md) |
| 时长、性能等已实现设计           | [当前架构的子系统入口](../architecture/current-architecture.md)                                                                                                             | [架构与性能记录](./README.md#架构与性能验证)                                                                            |
| 包内媒体分发设计                 | [媒体处理与分发](../architecture/media-delivery.md)                                                                                                                         | 包内路径保留兼容入口                                                                                                    |
| 旧后台/归档/扫描/系列/代表帧设计 | 相应当前领域或架构文档                                                                                                                                                      | [archive/design](../archive/README.md)；旧 design 路径短跳转                                                            |
| 部署基线中的专项升级             | [部署基线](../operations/deployment.md)、[专项门禁](../operations/runbooks/schema-and-capability-upgrades.md)                                                               | [发布记录](./README.md#发布迁移与事故)                                                                                  |
| 恢复手册中的领域修复与事故       | [备份恢复](../operations/backup-and-recovery.md)、[领域恢复](../operations/runbooks/domain-recovery.md)                                                                     | [归档事故](./operations/archive-retry-incident-2026-10-06.md)                                                           |
| 后台退役发布手册                 | [当前退役 runbook](../operations/runbooks/background-task-retirement.md)                                                                                                    | [生产确认与缺口](./operations/background-task-retirement-2026-10.md)                                                    |
| 根 TODO 的完成日志与两个旧 todos | [根 TODO](../../TODO.md)只保留未完成行动                                                                                                                                    | WebP 已完成证据归入对应架构记录；旧 todos 保留跳转                                                                      |
| WebP/时长图及新图                | `docs/diagrams/` 中独立源与 SVG                                                                                                                                             | 历史文档内嵌图保留其历史含义                                                                                            |

## 校准的事实

- 阅读架构的 1 秒合并与当前代码不符，统一按 `reading-contract.ts` 的 3 秒窗口描述。
- Pixiv 在线同步已经调用系列领域核对，不再声称系列信息只留磁盘快照。
- 当前中央执行路径不再保留 cutover=false 的旧 handler，维护隔离通过停止相应服务完成。
- 各文档的任务/版本数量不再手工同步，改由生产能力清单和 `capability-audit` 校验；历史记录保留当年数量。
- 动图时长探测候选与进度描述按当前查询及执行器校准，区分持续处理和进度刷新。
- 已实现且核验的正文与生产发布状态分开；Pixiv 默认已读的专项生产记录不再被其他文档覆盖为“未核验”。
- 独立复核发现并修正媒体写入边界：writer lane 只串行化 Worker 的 `SystemJob`，不覆盖 App 的直接文件写入；数据库执行围栏不回滚文件 I/O。组件图、产品基线、当前架构与 ADR 的边界说明已统一。

## 验证范围

验证项目为本地链接/锚点/大小写/围栏、Mermaid 解析与 SVG 源同步、变更文件格式、文档读取边界测试和图示人工抽查。文档检查工具另外用临时错误大小写、缺失锚点和未关闭围栏验证能报告错误，围栏内示例不作为链接检查。

本地执行结果：

| 检查                                              | 结果                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm docs:check`                                 | 166 份 Markdown 的本地链接、锚点、路径大小写与代码围栏通过                                           |
| `pnpm docs:diagrams` / `pnpm docs:diagrams:check` | 28 份独立图源生成 SVG 并通过源同步检查；23 个内嵌 Mermaid 块解析通过                                 |
| Worker `deployment-boundary.test.ts`              | 20 项通过；迁移后的当前部署文档仍提供能力审计门禁                                                    |
| 变更文件 Prettier 检查                            | 155 个 Markdown、脚本及相关配置/测试文件通过                                                         |
| Node 语法、`git diff --check`、主应用路径大小写   | 通过；主应用无大写路径                                                                               |
| 人工成图抽查                                      | 系统组件、领域 UML、归档与来源同步、来源核对、阅读、发布及恢复图；过宽的归档、核对与发布图已调整布局 |
| 独立内容复核                                      | 写入边界问题修正后通过，无遗留阻断项                                                                 |

首次 Worker 聚焦测试因本地缺失已声明的 `entities` 依赖链接未能加载；使用离线、冻结锁文件且忽略安装脚本的定向安装恢复链接后，重新执行通过。未更改依赖版本或锁文件。

本次不运行生产操作、数据库迁移或全量应用构建。真实上线状态与历史验证的限制均保持原记录含义；文档整理本身不能补足缺失的生产证据。持续验证命令见[文档维护](../development/documentation.md)。
