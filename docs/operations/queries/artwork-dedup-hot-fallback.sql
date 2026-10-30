-- DBX read-only. Replace only the run ID below. Execute on database pixishelf.
-- Needs existing column SELECT for system_jobs and system_job_events only.
-- Only committed events are returned; missing events do not prove no fallback
-- (older code has none, and an execution that loses its fence may only log to Worker).
-- Bounded to the latest 50 diagnostic events. Counts are not image counts or SQL counts.
WITH selected AS (SELECT 'replace-with-run-id'::text AS run_id),
job AS (
 SELECT j.id FROM system_jobs j JOIN selected s ON j.payload->>'runId'=s.run_id
 WHERE j.type='ARTWORK_DEDUP_SCAN'
)
SELECT e.id AS event_id,e."createdAt" AS captured_at,e."jobId" AS job_id,
 e.data->>'runId' AS run_id,e.data->>'diagnosticVersion' AS diagnostic_version,
 e.data->>'phase' AS phase,e.data->>'reason' AS reason,
 e.data->>'artworkId' AS artwork_id,e.data->>'imageId' AS image_id,
 e.data->>'batchFirstArtworkId' AS batch_first_artwork_id,
 e.data->>'batchArtworkCount' AS batch_artwork_count,
 e.data->'committedProgress' AS committed_progress_at_fallback,
 e.data->>'metadataBytes' AS metadata_bytes,e.data->>'statMs' AS property_inspection_ms
FROM system_job_events e JOIN job j ON j.id=e."jobId"
WHERE e.data->>'kind'='artwork-dedup.hot-fallback'
ORDER BY e.id DESC LIMIT 50;
