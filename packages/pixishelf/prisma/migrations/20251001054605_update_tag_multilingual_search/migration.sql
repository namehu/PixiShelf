-- 更新触发器函数以支持多语言搜索（name, name_zh, name_en）
-- 替换现有的触发器函数
CREATE OR REPLACE FUNCTION update_tag_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    -- 更新搜索向量，支持中英文混合搜索，包含所有三个语言字段
    NEW.search_vector := to_tsvector('simple',
        COALESCE(NEW.name, '') || ' ' || 
        COALESCE(NEW.name_zh, '') || ' ' || 
        COALESCE(NEW.name_en, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为现有数据重新初始化搜索向量，包含所有三个语言字段
UPDATE "Tag" SET search_vector = to_tsvector('simple',
    COALESCE(name, '') || ' ' || 
    COALESCE(name_zh, '') || ' ' || 
    COALESCE(name_en, '')
);