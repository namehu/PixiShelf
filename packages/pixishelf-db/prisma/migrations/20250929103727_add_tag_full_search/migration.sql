-- 添加全文搜索支持
-- 为标签表添加搜索向量列
-- ALTER TABLE "Tag" ADD COLUMN search_vector tsvector;

-- 创建触发器函数来自动更新搜索向量
CREATE OR REPLACE FUNCTION update_tag_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    -- 更新搜索向量，支持中英文混合搜索
    NEW.search_vector := to_tsvector('simple',
        COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.name_zh, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器
CREATE TRIGGER tag_search_vector_update
    BEFORE INSERT OR UPDATE ON "Tag"
    FOR EACH ROW EXECUTE FUNCTION update_tag_search_vector();

-- 为现有数据初始化搜索向量
UPDATE "Tag" SET search_vector = to_tsvector('simple',
    COALESCE(name, '') || ' ' || COALESCE(name_zh, '')
);
