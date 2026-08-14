-- 回滚脚本：移除 Artwork.imageCount 自动计数机制

-- 1. 删除触发器
DROP TRIGGER IF EXISTS artwork_image_count_trigger ON "Image";
DROP TRIGGER IF EXISTS artwork_image_count_delete_trigger ON "Image";
DROP TRIGGER IF EXISTS artwork_image_count_update_trigger ON "Image";

-- 2. 删除触发器函数
DROP FUNCTION IF EXISTS update_artwork_image_count;

-- 3. (可选) 重置 imageCount 为 0 或保持原样
-- 如果需要彻底回滚到应用层维护状态，理论上不需要改数据，因为应用层会覆盖它。
-- 但为了安全起见，这里不做数据修改。
