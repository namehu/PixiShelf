---
status: deprecated
scope: 旧版临时 SQL 片段，不作为数据库操作或运维手册
last-verified: 2026-08-18
---

# 常用 SQL（待清理）

> 本文只保留少量历史查询片段，未形成可验证的运行手册。字段和模型以 Prisma Schema 为准。

## Tag

```sql
-- 查询所有Tag名称
SELECT "name" FROM public."Tag";

-- 查询所有Pixiv Tag数量
SELECT COUNT(*)
FROM "Tag"
WHERE "translateType" = 'PIXIV';

-- 查询所有Pixiv Tag名称、中文名称、英文名称、摘要
SELECT name, name_zh, name_en, abstract
FROM "Tag"
WHERE "translateType" = 'PIXIV';
```

## Artist

```sql
-- 查询所有Artist用户ID
SELECT "userId" FROM public."Artist";
```
