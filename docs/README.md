# PixiShelf 文档入口

先根据要解决的问题选择入口。当前行为、未来方案与历史证据分开阅读；精确字段、配置和接口以代码、Schema、Compose 与环境模板为准。

## 推荐阅读路径

| 你要做什么       | 阅读顺序                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 理解项目         | [产品基线](./product/product-baseline.md) → [领域术语与关系](../CONTEXT.md) → [当前架构](./architecture/current-architecture.md)         |
| 修改一个功能     | [功能目录](./features/README.md) → 对应领域规格 → 规格链接的架构、代码和验收条件                                                         |
| 理解同艺术家去重 | [当前功能与六张图](./features/artwork-deduplication.md) → 所需契约或验收记录；首屏区分已实现、待完成与不做的范围                         |
| 理解复杂设计     | [架构总览](./architecture/current-architecture.md) → [图示导航](./diagrams/README.md) → 对应子系统说明                                   |
| 启动本地环境     | [根 README](../README.md) → [主应用包说明](../packages/pixishelf/readme.md)                                                              |
| 修改代码并验证   | [工程规则](../AGENTS.md) → [测试策略](./development/testing-strategy.md)；认证或媒体访问变更先读[权限边界](./security/access-control.md) |
| 部署、升级或恢复 | [部署基线](./operations/deployment.md) → 适用的专项手册 → [备份与恢复](./operations/backup-and-recovery.md)                              |
| 追溯理由与证据   | [ADR](./adr/README.md) → [发布与验证记录](./records/README.md)；退役方案见[历史索引](./archive/README.md)                                |
| 评估未来方案     | [方案入口](./design/README.md)；未核验设计不覆盖当前行为                                                                                 |

## 文档职责

| 区域                         | 唯一职责                                           |
| ---------------------------- | -------------------------------------------------- |
| `product/` 与根 `CONTEXT.md` | 产品范围、非目标与不变量；领域术语                 |
| `architecture/`              | 当前系统边界、依赖、数据一致性与子系统机制         |
| `features/`                  | 按领域组织的用户行为、业务规则、异常路径与验收条件 |
| `security/`                  | 身份、信任边界、访问控制与安全回归要求             |
| `operations/`                | 当前部署、备份恢复与有条件适用的操作手册           |
| `development/`               | 开发验证与文档维护方法                             |
| `adr/`                       | 已接受的技术决策、原因、代价和替代关系             |
| `design/`                    | 尚未实施或核验的设计，以及已迁移内容的兼容入口     |
| `records/`                   | 特定日期、版本和环境的发布、验证、实验与事故证据   |
| `archive/`                   | 已退役方案和历史实施过程，不能直接作为当前操作依据 |
| `diagrams/`                  | 与权威正文绑定的 Mermaid 源与生成 SVG              |

包内 README 说明包级用法；组件和脚本文档就近保存。它们不再维护另一套系统架构或部署流程。

## 如何判断一份文档可否作为依据

- `current`：正文已按所列代码或配置核对；**不代表某个生产实例已经部署**。
- `draft`：未来设计，或尚未充分核验的内容；不能当作当前行为。
- `historical`：特定历史版本的方案或证据；“通过”“当前”等措辞只对记录当时成立。
- `deprecated`：短跳转或待退役材料；沿链接阅读替代文档。
- ADR 使用 `proposed / accepted / superseded`，并保留局部替代关系。

生产状态只由对应发布记录说明：区分本地测试、隔离验证、用户确认和可复核生产证据。未记录不等于未部署，也不能推断已验收。

发现文档冲突时，先确认讨论的是产品要求、当前实现还是历史版本。精确事实核对代码与配置；产品要求和实现不一致时显式记录差异，不用修改文档偷偷改变要求。当前文档更新对应章节，历史证据保持当时语境。

## 开发与维护入口

- [Android 验证版](./features/android-app.md)与[Flutter 包用法](../packages/pixishelf-app/README.md)。

- [文档维护规则](./development/documentation.md)：内容归属、模板、状态与图示检查。
- [当前待办](../TODO.md)：未完成的实施或验证行动。
- [构建资产](../build/README.md)、[CI 与镜像发布](../.github/README.md)、[辅助工具](../scripts/README.md)。
- [数据库设计补充](../packages/pixishelf-db/prisma/database-design.md)：Schema 之外的数据库语义与约束。
- [扫描 Webhook](../packages/pixishelf/docs/webhook-features.md)、[ProTable](../packages/pixishelf/components/shared/pro-table/readme.md)、[Pixiv 提取脚本](../packages/pixishelf/scripts/extract-pixiv-info.md)。
- [本次重整与文档去向](./records/documentation-reorganization-2026-10-22.md)。
