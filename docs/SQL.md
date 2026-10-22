---
status: deprecated
scope: 旧版临时 SQL 的兼容入口
last-verified: 2026-10-22
replaced-by: ../packages/pixishelf-db/prisma/database-design.md
---

# 数据库查询说明已整理

字段与关系以 [Prisma Schema](../packages/pixishelf-db/prisma/schema.prisma) 为准；Schema 之外的约束、触发器与维护语义见[数据库设计补充](../packages/pixishelf-db/prisma/database-design.md)。生产修复操作必须遵循[备份与恢复](./operations/backup-and-recovery.md)。

原零散 Tag 查询未形成经验证的运行手册，已退出主线；需要追溯时查看本文件 Git 历史，不将旧字段片段作为当前操作依据。
