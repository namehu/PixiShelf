-- complete means successful publication, not that every metric is measured.
-- updatedAt is the snapshot cutoff. Historical API counters exclude runtime fence internals;
-- v9 reports those separately as dbFenceCalls and transactionTiming.
-- transactionTiming.complete=false means the current final commit is not sampled.
-- API counters still exclude
-- subsequent snapshot writes/settlement; transactionWall excludes the current
-- finalizer commit, although its known transaction count is included.
-- DBX read-only template. Replace only the run id literal in the first CTE.
-- Missing JSON metrics remain NULL (unknown), never zero. No instance-wide stats
-- are attributed to this run; call counts are not SQL statement counts.
WITH selected AS (SELECT 'replace-with-run-id'::text AS run_id),
snapshot AS (
  SELECT r.id, r.status, r.stage, r."jobId", j."definitionVersion",
    r."visualSearchVersion", r."visualSearchComplete", r."visualInputDigest",
    r."performanceSummary" AS p, j."progressData", r."updatedAt"
  FROM "ArtworkDedupRun" r
  LEFT JOIN system_jobs j ON j.id=r."jobId"
  JOIN selected s ON s.run_id=r.id
)
SELECT id AS run_id, "jobId" AS job_id, status, stage,
  "definitionVersion" AS protocol_version, "visualSearchVersion" AS search_version,
  "visualSearchComplete" AS static_search_complete, "visualInputDigest" AS input_digest,
  "progressData" AS phase_progress,
  p->>'updatedAt' AS metrics_through, p->>'complete' AS lifecycle_complete,
  p->>'batch' AS committed_batch, p->'progress' AS coverage,
  p->'cacheInvalidationReasons' AS cache_invalidation_reasons,
  p->'counters' AS counters, p->'durationsMs' AS durations_ms,
  (p->>'memoryPeakBytes')::numeric AS memory_peak_bytes,
  (p->>'metadataPeakBytes')::numeric AS metadata_peak_bytes,
  p->'transactionTiming' AS transaction_timing_coverage,
  (SELECT jsonb_object_agg(key,value) FROM jsonb_each(p->'counters') WHERE value='null'::jsonb) AS unknown_counters,
  (SELECT jsonb_object_agg(key,value) FROM jsonb_each(p->'durationsMs') WHERE value='null'::jsonb) AS unknown_durations,
  CASE WHEN p IS NULL THEN 'No performance snapshot; bottleneck unknown'
    ELSE 'DB calls are API calls; transactionWall includes round trips and wait, not WAL time' END AS interpretation,
  "updatedAt" AS run_updated_at
FROM snapshot;
