# 提取 Pixiv 图片信息

## 使用方式

参照 `extract-pixiv-info.js` 中的注释

## 辅助SQL

### 提取所有作品ID

```sql
SELECT "externalId" FROM public."Artwork";
```

结果中选择整列 - 复制 - 粘贴到 编辑器中 - 添加尾逗号 - 通过 `pixivScraper.addArtworkIds`方法批量添加

### 根据Tag ID查询作品信息

```sql
SELECT
  "A".*
FROM
  "Artwork" AS "A"
INNER JOIN
  "ArtworkTag" AS "AT" ON "A"."id" = "AT"."artworkId"
WHERE
  "AT"."tagId" = [您要查询的TagID];
```
