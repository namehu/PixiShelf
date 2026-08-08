-- 为从标签反查作品、标签删除和标签计数提供反向复合索引。
CREATE INDEX IF NOT EXISTS "ArtworkTag_tagId_artworkId_idx"
ON "ArtworkTag" ("tagId", "artworkId");

-- 早期迁移同时创建了两套字段完全相同的 TriggerLog 索引；保留显式命名的一套。
DROP INDEX IF EXISTS "TriggerLog_created_at_idx";
DROP INDEX IF EXISTS "TriggerLog_operation_idx";
DROP INDEX IF EXISTS "TriggerLog_table_name_record_id_idx";

-- 删除逐行触发器，避免批量导入时按关联数量更新标签并写成功日志。
DROP TRIGGER IF EXISTS artwork_tag_after_insert_trigger ON "ArtworkTag";
DROP TRIGGER IF EXISTS artwork_tag_after_delete_trigger ON "ArtworkTag";
DROP TRIGGER IF EXISTS artwork_tag_after_update_trigger ON "ArtworkTag";

DROP FUNCTION IF EXISTS update_tag_artwork_count_on_insert();
DROP FUNCTION IF EXISTS update_tag_artwork_count_on_delete();
DROP FUNCTION IF EXISTS update_tag_artwork_count_on_update();
DROP FUNCTION IF EXISTS update_tag_count_safe(INTEGER, INTEGER);

-- 每条 SQL 语句只聚合一次受影响标签，并通过原子增量更新保持并发正确性。
CREATE OR REPLACE FUNCTION update_tag_artwork_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        WITH deltas AS (
            SELECT "tagId", COUNT(*)::INTEGER AS delta
            FROM new_table
            GROUP BY "tagId"
        )
        UPDATE "Tag" t
        SET
            "artworkCount" = t."artworkCount" + d.delta,
            "updatedAt" = CURRENT_TIMESTAMP
        FROM deltas d
        WHERE t.id = d."tagId";

    ELSIF TG_OP = 'DELETE' THEN
        WITH deltas AS (
            SELECT "tagId", COUNT(*)::INTEGER AS delta
            FROM old_table
            GROUP BY "tagId"
        )
        UPDATE "Tag" t
        SET
            "artworkCount" = GREATEST(t."artworkCount" - d.delta, 0),
            "updatedAt" = CURRENT_TIMESTAMP
        FROM deltas d
        WHERE t.id = d."tagId";

    ELSIF TG_OP = 'UPDATE' THEN
        WITH changes AS (
            SELECT "tagId", -COUNT(*)::INTEGER AS delta
            FROM old_table
            GROUP BY "tagId"

            UNION ALL

            SELECT "tagId", COUNT(*)::INTEGER AS delta
            FROM new_table
            GROUP BY "tagId"
        ),
        deltas AS (
            SELECT "tagId", SUM(delta)::INTEGER AS delta
            FROM changes
            GROUP BY "tagId"
            HAVING SUM(delta) <> 0
        )
        UPDATE "Tag" t
        SET
            "artworkCount" = GREATEST(t."artworkCount" + d.delta, 0),
            "updatedAt" = CURRENT_TIMESTAMP
        FROM deltas d
        WHERE t.id = d."tagId";
    END IF;

    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    -- 计数与关联写入必须保持原子性；失败交由 PostgreSQL/应用日志记录，禁止静默吞错。
    RAISE EXCEPTION 'Failed to update tag artwork count'
        USING ERRCODE = '45P02', DETAIL = SQLERRM;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER artwork_tag_after_insert_trigger
    AFTER INSERT ON "ArtworkTag"
    REFERENCING NEW TABLE AS new_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION update_tag_artwork_count();

CREATE TRIGGER artwork_tag_after_delete_trigger
    AFTER DELETE ON "ArtworkTag"
    REFERENCING OLD TABLE AS old_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION update_tag_artwork_count();

CREATE TRIGGER artwork_tag_after_update_trigger
    AFTER UPDATE ON "ArtworkTag"
    REFERENCING OLD TABLE AS old_table NEW TABLE AS new_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION update_tag_artwork_count();

-- 一次扫描 ArtworkTag 校准全部标签，作为从旧逐行触发器迁移后的基线。
WITH counts AS (
    SELECT
        t.id,
        COALESCE(c.artwork_count, 0)::INTEGER AS artwork_count
    FROM "Tag" t
    LEFT JOIN (
        SELECT "tagId", COUNT(*) AS artwork_count
        FROM "ArtworkTag"
        GROUP BY "tagId"
    ) c ON c."tagId" = t.id
)
UPDATE "Tag" t
SET
    "artworkCount" = counts.artwork_count,
    "updatedAt" = CURRENT_TIMESTAMP
FROM counts
WHERE t.id = counts.id
  AND t."artworkCount" IS DISTINCT FROM counts.artwork_count;

-- 手动修复函数同样采用集合式更新，并且只写一条维护摘要日志。
CREATE OR REPLACE FUNCTION fix_tag_count_inconsistencies()
RETURNS INTEGER AS $$
DECLARE
    fixed_count INTEGER;
BEGIN
    WITH counts AS (
        SELECT
            t.id,
            COALESCE(c.artwork_count, 0)::INTEGER AS artwork_count
        FROM "Tag" t
        LEFT JOIN (
            SELECT "tagId", COUNT(*) AS artwork_count
            FROM "ArtworkTag"
            GROUP BY "tagId"
        ) c ON c."tagId" = t.id
    )
    UPDATE "Tag" t
    SET
        "artworkCount" = counts.artwork_count,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM counts
    WHERE t.id = counts.id
      AND t."artworkCount" IS DISTINCT FROM counts.artwork_count;

    GET DIAGNOSTICS fixed_count = ROW_COUNT;

    IF fixed_count > 0 THEN
        INSERT INTO "TriggerLog" (operation, table_name, new_value, error_message)
        VALUES ('FIX', 'Tag', fixed_count, 'Set-based tag count reconciliation');
    END IF;

    RETURN fixed_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_tag_artwork_count() IS
'语句级维护 Tag.artworkCount；成功操作不写 TriggerLog，失败时中止关联写入';
COMMENT ON FUNCTION fix_tag_count_inconsistencies() IS
'集合式修复所有标签计数，并写入单条维护摘要日志';
