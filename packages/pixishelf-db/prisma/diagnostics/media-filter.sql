-- 生产只读检查：媒体类型完整性与候选索引执行计划。
-- 建议在低峰期执行；事务结束后不会保留任何数据修改。
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

-- 1. mediaType 分布。切换粗粒度筛选前，UNKNOWN 应为 0。
SELECT
  "mediaType",
  COUNT(*) AS media_count,
  ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 4) AS percentage
FROM "Image"
GROUP BY "mediaType"
ORDER BY media_count DESC;

-- 2. 如果存在 UNKNOWN，按扩展名汇总并提供少量样本，供确认分类任务是否覆盖。
SELECT
  COALESCE(LOWER(SUBSTRING(path FROM '(\.[^./\\]+)$')), '<no-extension>') AS extension,
  COUNT(*) AS media_count
FROM "Image"
WHERE "mediaType" = 'UNKNOWN'
GROUP BY extension
ORDER BY media_count DESC
LIMIT 30;

SELECT id, "artworkId", path
FROM "Image"
WHERE "mediaType" = 'UNKNOWN'
ORDER BY id
LIMIT 30;

-- 3. 当前 Image 索引大小与使用次数，仅用于辅助解释执行计划。
SELECT
  indexrelname AS index_name,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = current_schema()
  AND relname = 'Image'
ORDER BY indexrelname;

-- 4. 列表“视频作品”筛选的代表性查询。
EXPLAIN (ANALYZE, BUFFERS, SETTINGS)
SELECT a.id
FROM "Artwork" a
WHERE EXISTS (
  SELECT 1
  FROM "Image" i
  WHERE i."artworkId" = a.id
    AND i."mediaType" = 'VIDEO'
)
ORDER BY a."sourceDate" DESC, a.id DESC
LIMIT 101;

-- 5. 批量取得近期作品首个媒体的代表性查询。
EXPLAIN (ANALYZE, BUFFERS, SETTINGS)
WITH recent_artworks AS MATERIALIZED (
  SELECT id
  FROM "Artwork"
  ORDER BY "sourceDate" DESC, id DESC
  LIMIT 100
)
SELECT DISTINCT ON (i."artworkId")
  i."artworkId",
  i.id,
  i."sortOrder"
FROM "Image" i
JOIN recent_artworks a ON a.id = i."artworkId"
ORDER BY i."artworkId", i."sortOrder", i.id;

COMMIT;
