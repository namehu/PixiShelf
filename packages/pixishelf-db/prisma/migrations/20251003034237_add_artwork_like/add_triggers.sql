-- 创建触发器函数来自动更新点赞计数
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

-- 创建触发器
CREATE TRIGGER artwork_like_count_trigger
    AFTER INSERT OR DELETE ON "ArtworkLike"
    FOR EACH ROW EXECUTE FUNCTION update_artwork_like_count();

-- 初始化现有作品的点赞计数（如果有数据的话）
UPDATE "Artwork" SET "likeCount" = (
    SELECT COUNT(*) FROM "ArtworkLike" WHERE "artworkId" = "Artwork"."id"
);