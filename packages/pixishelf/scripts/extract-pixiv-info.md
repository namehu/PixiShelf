# 提取 Pixiv 图片信息

## 使用方式

参照 `extract-pixiv-info.js` 中的注释

## 辅助SQL

### 提取所有作品ID

```sql
SELECT "externalId" FROM public."Artwork";
```

结果中选择整列 - 复制 - 粘贴到 编辑器中 - 添加尾逗号 - 通过 `pixivScraper.addArtworkIds`方法批量添加

