---
status: historical
scope: 创作者关系的既有隔离数据库与浏览器验证
last-verified: 2026-09-08
sources:
  - docs/features/creator-relations.md
---

# 创作者关系验证记录

原规格未单独登记精确提交、验收日期和生产镜像；下列结果对应当时开发工作区，不代表本轮重跑或生产发布。当前规则见[功能规格](../../features/creator-relations.md)。

## 验证依据

- 隔离 PostgreSQL 从空库部署完整 76 项迁移，新版 schema 门禁验证通过。
- 关系测试覆盖标签重放、缺失与空来源、人工排除、映射恢复、实体类型边界及存储身份保留。
- 维护任务测试覆盖跨批次冻结、暂停／取消后继续、依据过期和未知来源。
- 实际浏览器验证多创作者详情、选择社团、来源／入库时间切换、社团全部作品及缺少 READY Worker 时禁止提交。
- 主应用 lint、typecheck、生产构建及全量单元回归通过；独立 Worker 类型、构建及能力清单验证通过。PostgreSQL 领域回归另以隔离连接执行。
