# 常用SQL

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
