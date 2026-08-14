-- CreateIndex
CREATE INDEX "Tag_artworkCount_name_idx" ON "Tag"("artworkCount" DESC, "name");

-- ============================================================================
-- 添加缺失的 ArtworkLike 触发器（来自 add_triggers.sql）
-- ============================================================================

-- 创建触发器函数来自动更新点赞计数（如果不存在）
CREATE OR REPLACE FUNCTION update_artwork_like_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- 点赞时增加计数
        UPDATE "Artwork" SET "likeCount" = "likeCount" + 1 WHERE "id" = NEW."artworkId";
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- 取消点赞时减少计数
        UPDATE "Artwork" SET "likeCount" = "likeCount" - 1 WHERE "id" = OLD."artworkId";
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'artwork_like_count_trigger'
    ) THEN
        CREATE TRIGGER artwork_like_count_trigger
            AFTER INSERT OR DELETE ON "ArtworkLike"
            FOR EACH ROW EXECUTE FUNCTION update_artwork_like_count();
    END IF;
END $$;

-- 初始化现有作品的点赞计数（如果有数据的话）
UPDATE "Artwork" SET "likeCount" = (
    SELECT COUNT(*) FROM "ArtworkLike" WHERE "artworkId" = "Artwork"."id"
);

-- ============================================================================
-- 添加缺失的 Tag 全文搜索索引（来自 add_fulltext_index.sql）
-- ============================================================================

-- 创建GIN索引用于全文搜索（如果不存在）
CREATE INDEX IF NOT EXISTS "Tag_name_fulltext_idx" ON "Tag" USING gin(to_tsvector('english', "name"));

-- 创建部分索引（只索引有作品的标签）（如果不存在）
CREATE INDEX IF NOT EXISTS "Tag_popular_idx" ON "Tag" ("artworkCount" DESC) WHERE "artworkCount" > 0;
