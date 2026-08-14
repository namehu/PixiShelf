-- 1. 创建触发器函数：自动更新 Artwork.imageCount (语句级优化版)
-- 该函数在每次 SQL 语句执行后触发一次，而不是每一行，极大减少了数据库 I/O
CREATE OR REPLACE FUNCTION update_artwork_image_count()
RETURNS TRIGGER AS $$
BEGIN
    -- 针对 INSERT 操作
    IF (TG_OP = 'INSERT') THEN
        WITH delta AS (
            SELECT "artworkId", COUNT(*) as cnt
            FROM new_table
            WHERE "artworkId" IS NOT NULL
            GROUP BY "artworkId"
        )
        UPDATE "Artwork" a
        SET "imageCount" = a."imageCount" + d.cnt
        FROM delta d
        WHERE a.id = d."artworkId";

    -- 针对 DELETE 操作
    ELSIF (TG_OP = 'DELETE') THEN
        WITH delta AS (
            SELECT "artworkId", COUNT(*) as cnt
            FROM old_table
            WHERE "artworkId" IS NOT NULL
            GROUP BY "artworkId"
        )
        UPDATE "Artwork" a
        SET "imageCount" = a."imageCount" - d.cnt
        FROM delta d
        WHERE a.id = d."artworkId";

    -- 针对 UPDATE 操作
    ELSIF (TG_OP = 'UPDATE') THEN
        -- 注意：FOR EACH STATEMENT 触发器不支持 OF column_name 语法与 REFERENCING 同时使用
        -- 所以我们需要在 SQL 逻辑内部判断是否确实修改了 artworkId
        WITH updates AS (
            -- 计算旧值的减少量
            SELECT "artworkId", -COUNT(*) as change
            FROM old_table
            WHERE "artworkId" IS NOT NULL
            GROUP BY "artworkId"

            UNION ALL

            -- 计算新值的增加量
            SELECT "artworkId", COUNT(*) as change
            FROM new_table
            WHERE "artworkId" IS NOT NULL
            GROUP BY "artworkId"
        ),
        aggregated_changes AS (
            SELECT "artworkId", SUM(change) as total_change
            FROM updates
            GROUP BY "artworkId"
            HAVING SUM(change) != 0
        )
        UPDATE "Artwork" a
        SET "imageCount" = a."imageCount" + ac.total_change
        FROM aggregated_changes ac
        WHERE a.id = ac."artworkId";
    END IF;

    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    -- 抛出自定义 SQLSTATE '45P01' 供应用层重试
    RAISE EXCEPTION 'Failed to update artwork image count' USING ERRCODE = '45P01';
END;
$$ LANGUAGE plpgsql;

-- 2. 创建触发器 (使用 FOR EACH STATEMENT)
DROP TRIGGER IF EXISTS artwork_image_count_trigger ON "Image";
DROP TRIGGER IF EXISTS artwork_image_count_delete_trigger ON "Image";
DROP TRIGGER IF EXISTS artwork_image_count_update_trigger ON "Image";

CREATE TRIGGER artwork_image_count_trigger
    AFTER INSERT ON "Image"
    REFERENCING NEW TABLE AS new_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION update_artwork_image_count();

CREATE TRIGGER artwork_image_count_delete_trigger
    AFTER DELETE ON "Image"
    REFERENCING OLD TABLE AS old_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION update_artwork_image_count();

-- 修正：PostgreSQL 不支持在 FOR EACH STATEMENT 触发器中指定 OF columns 并使用 REFERENCING
-- 我们去掉 OF "artworkId"，改为监听所有 UPDATE，然后在函数内部逻辑通过比较 old_table 和 new_table (虽然这里简化为直接计算差值，
-- 只要 artworkId 没变，old 和 new 的 group by 结果会抵消，change = 0)
CREATE TRIGGER artwork_image_count_update_trigger
    AFTER UPDATE ON "Image"
    REFERENCING OLD TABLE AS old_table NEW TABLE AS new_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION update_artwork_image_count();

-- 3. 存量数据校正 (带行级锁)
-- 校正所有 Artwork 的 imageCount
UPDATE "Artwork"
SET "imageCount" = (
    SELECT COUNT(*)
    FROM "Image"
    WHERE "Image"."artworkId" = "Artwork"."id"
);
