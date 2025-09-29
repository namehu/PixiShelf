-- CreateTable
CREATE TABLE "TriggerLog" (
    "id" SERIAL NOT NULL,
    "operation" VARCHAR(10) NOT NULL,
    "table_name" VARCHAR(50) NOT NULL,
    "record_id" INTEGER,
    "old_value" INTEGER,
    "new_value" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriggerLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TriggerLog_created_at_idx" ON "TriggerLog"("created_at");

-- CreateIndex
CREATE INDEX "TriggerLog_operation_idx" ON "TriggerLog"("operation");

-- CreateIndex
CREATE INDEX "TriggerLog_table_name_record_id_idx" ON "TriggerLog"("table_name", "record_id");


-- =====================================================
-- 触发器与函数 (由原生SQL管理)
-- 版本：v2.2 - 混合模式
-- =====================================================

-- 注意：TriggerLog表已在上方创建，同时也在Prisma schema中定义


-- 1. 创建通用的标签计数更新函数
CREATE OR REPLACE FUNCTION update_tag_count_safe(tag_id INTEGER, delta INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    affected_rows INTEGER;
    current_count INTEGER;
BEGIN
    -- 获取当前计数（加锁防止并发问题）
    SELECT "artworkCount" INTO current_count
    FROM "Tag"
    WHERE id = tag_id
    FOR UPDATE;

    -- 检查标签是否存在
    IF NOT FOUND THEN
        INSERT INTO "TriggerLog" (operation, table_name, record_id, error_message)
        VALUES ('UPDATE', 'Tag', tag_id, 'Tag not found for count update');
        RETURN FALSE;
    END IF;

    -- 防止计数变为负数
    IF current_count + delta < 0 THEN
        INSERT INTO "TriggerLog" (operation, table_name, record_id, old_value, new_value, error_message)
        VALUES ('UPDATE', 'Tag', tag_id, current_count, 0, 'Count would become negative, setting to 0');

        UPDATE "Tag"
        SET "artworkCount" = 0, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = tag_id;
        RETURN TRUE;
    END IF;

    -- 执行更新
    UPDATE "Tag"
    SET "artworkCount" = "artworkCount" + delta, "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = tag_id;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;

    -- 记录成功的操作
    IF affected_rows > 0 THEN
        INSERT INTO "TriggerLog" (operation, table_name, record_id, old_value, new_value)
        VALUES ('UPDATE', 'Tag', tag_id, current_count, current_count + delta);
        RETURN TRUE;
    ELSE
        INSERT INTO "TriggerLog" (operation, table_name, record_id, error_message)
        VALUES ('UPDATE', 'Tag', tag_id, 'Update failed - no rows affected');
        RETURN FALSE;
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        INSERT INTO "TriggerLog" (operation, table_name, record_id, error_message)
        VALUES ('UPDATE', 'Tag', tag_id, SQLERRM);
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- 2. INSERT触发器函数
CREATE OR REPLACE FUNCTION update_tag_artwork_count_on_insert()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM update_tag_count_safe(NEW."tagId", 1);

    INSERT INTO "TriggerLog" (operation, table_name, record_id)
    VALUES ('INSERT', 'ArtworkTag', NEW.id);

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        INSERT INTO "TriggerLog" (operation, table_name, record_id, error_message)
        VALUES ('INSERT', 'ArtworkTag', NEW.id, SQLERRM);
        RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. DELETE触发器函数
CREATE OR REPLACE FUNCTION update_tag_artwork_count_on_delete()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM update_tag_count_safe(OLD."tagId", -1);

    INSERT INTO "TriggerLog" (operation, table_name, record_id)
    VALUES ('DELETE', 'ArtworkTag', OLD.id);

    RETURN OLD;
EXCEPTION
    WHEN OTHERS THEN
        INSERT INTO "TriggerLog" (operation, table_name, record_id, error_message)
        VALUES ('DELETE', 'ArtworkTag', OLD.id, SQLERRM);
        RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 4. UPDATE触发器函数
CREATE OR REPLACE FUNCTION update_tag_artwork_count_on_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."tagId" != NEW."tagId" THEN
        PERFORM update_tag_count_safe(OLD."tagId", -1);
        PERFORM update_tag_count_safe(NEW."tagId", 1);

        INSERT INTO "TriggerLog" (operation, table_name, record_id, old_value, new_value)
        VALUES ('UPDATE', 'ArtworkTag', NEW.id, OLD."tagId", NEW."tagId");
    END IF;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        INSERT INTO "TriggerLog" (operation, table_name, record_id, error_message)
        VALUES ('UPDATE', 'ArtworkTag', NEW.id, SQLERRM);
        RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. 删除旧触发器（确保幂等性）
DROP TRIGGER IF EXISTS artwork_tag_after_insert_trigger ON "ArtworkTag";
DROP TRIGGER IF EXISTS artwork_tag_after_delete_trigger ON "ArtworkTag";
DROP TRIGGER IF EXISTS artwork_tag_after_update_trigger ON "ArtworkTag";

-- 6. 创建新的触发器
CREATE TRIGGER artwork_tag_after_insert_trigger
    AFTER INSERT ON "ArtworkTag"
    FOR EACH ROW
    EXECUTE FUNCTION update_tag_artwork_count_on_insert();

CREATE TRIGGER artwork_tag_after_delete_trigger
    AFTER DELETE ON "ArtworkTag"
    FOR EACH ROW
    EXECUTE FUNCTION update_tag_artwork_count_on_delete();

CREATE TRIGGER artwork_tag_after_update_trigger
    AFTER UPDATE ON "ArtworkTag"
    FOR EACH ROW
    EXECUTE FUNCTION update_tag_artwork_count_on_update();

-- 7. 创建辅助函数 (check, fix, cleanup)
CREATE OR REPLACE FUNCTION check_tag_count_consistency()
RETURNS TABLE(tag_id INTEGER, tag_name VARCHAR, expected_count BIGINT, actual_count INTEGER, is_consistent BOOLEAN) AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id as tag_id,
        t.name as tag_name,
        COALESCE(at_count.count, 0) as expected_count,
        t."artworkCount" as actual_count,
        (COALESCE(at_count.count, 0) = t."artworkCount") as is_consistent
    FROM "Tag" t
    LEFT JOIN (
        SELECT "tagId", COUNT(*) as count
        FROM "ArtworkTag"
        GROUP BY "tagId"
    ) at_count ON t.id = at_count."tagId"
    ORDER BY t.id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fix_tag_count_inconsistencies()
RETURNS INTEGER AS $$
DECLARE
    fixed_count INTEGER := 0;
    tag_record RECORD;
BEGIN
    FOR tag_record IN
        SELECT * FROM check_tag_count_consistency() WHERE NOT is_consistent
    LOOP
        UPDATE "Tag"
        SET "artworkCount" = tag_record.expected_count, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = tag_record.tag_id;

        INSERT INTO "TriggerLog" (operation, table_name, record_id, old_value, new_value, error_message)
        VALUES ('FIX', 'Tag', tag_record.tag_id, tag_record.actual_count, tag_record.expected_count, 'Auto-fixed inconsistent count');

        fixed_count := fixed_count + 1;
    END LOOP;

    RETURN fixed_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_trigger_logs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM "TriggerLog"
    WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 8. 创建索引和注释
CREATE INDEX IF NOT EXISTS idx_trigger_log_created_at ON "TriggerLog" (created_at);
CREATE INDEX IF NOT EXISTS idx_trigger_log_operation ON "TriggerLog" (operation);
CREATE INDEX IF NOT EXISTS idx_trigger_log_table_record ON "TriggerLog" (table_name, record_id);

COMMENT ON FUNCTION update_tag_count_safe(INTEGER, INTEGER) IS '安全更新标签计数，包含错误处理和并发控制';
COMMENT ON FUNCTION check_tag_count_consistency() IS '检查标签计数的一致性';
COMMENT ON FUNCTION fix_tag_count_inconsistencies() IS '自动修复不一致的标签计数';
COMMENT ON FUNCTION cleanup_trigger_logs() IS '清理30天前的触发器日志';
COMMENT ON TABLE "TriggerLog" IS '触发器操作日志表，用于监控和调试';
