-- 添加PostgreSQL全文搜索索引
-- 这个索引将支持标签名称的全文搜索功能

-- 创建GIN索引用于全文搜索
CREATE INDEX "Tag_name_fulltext_idx" ON "Tag" USING gin(to_tsvector('english', "name"));

-- 创建复合索引优化查询性能
CREATE INDEX "Tag_artworkCount_name_idx" ON "Tag" ("artworkCount" DESC, "name");

-- 创建部分索引（只索引有作品的标签）
CREATE INDEX "Tag_popular_idx" ON "Tag" ("artworkCount" DESC) WHERE "artworkCount" > 0;