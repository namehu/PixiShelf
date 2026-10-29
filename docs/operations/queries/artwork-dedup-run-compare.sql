-- complete means successful publication, not that every metric is measured.
-- updatedAt is the snapshot cutoff. API calls exclude runtime fence internals,
-- subsequent snapshot writes/settlement; transactionWall excludes the current
-- finalizer commit, although its known transaction count is included.
-- DBX read-only template. Replace only the two run id literals below.
-- Review input/version/cache checks before treating deltas as an A/B result.
-- Same-input does not establish same hardware or identical frozen feature cache.
WITH selected AS (SELECT 'replace-with-baseline-run-id'::text AS baseline_id,
  'replace-with-comparison-run-id'::text AS comparison_id),
runs AS (
  SELECT r.id,r.mode,r.status,r."visualInputDigest",r."visualSearchVersion",
    j."definitionVersion",r."performanceSummary" AS p
  FROM "ArtworkDedupRun" r LEFT JOIN system_jobs j ON j.id=r."jobId"
  JOIN selected s ON r.id IN(s.baseline_id,s.comparison_id)
), pair AS (
  SELECT b.id AS baseline_id,n.id AS comparison_id,b.p AS baseline,n.p AS comparison,
    CASE WHEN b."visualInputDigest" IS NULL OR n."visualInputDigest" IS NULL THEN NULL
      ELSE b."visualInputDigest"=n."visualInputDigest" END AS same_input,
    b.mode AS baseline_mode,n.mode AS comparison_mode,
    b."definitionVersion" AS baseline_protocol,n."definitionVersion" AS comparison_protocol,
    b."visualSearchVersion" AS baseline_search,n."visualSearchVersion" AS comparison_search,
    b.status AS baseline_status,n.status AS comparison_status
  FROM selected s JOIN runs b ON b.id=s.baseline_id JOIN runs n ON n.id=s.comparison_id
), measurements AS (
  SELECT pair.*,group_name,key,
    (baseline #>> ARRAY[group_name,key])::numeric AS baseline_value,
    (comparison #>> ARRAY[group_name,key])::numeric AS comparison_value
  FROM pair CROSS JOIN LATERAL (VALUES ('counters'),('durationsMs')) groups(group_name)
  CROSS JOIN LATERAL (
    SELECT jsonb_object_keys(COALESCE(baseline->group_name,'{}'::jsonb) || COALESCE(comparison->group_name,'{}'::jsonb)) AS key
  ) keys
)
SELECT baseline_id,comparison_id,same_input,baseline_mode,comparison_mode,
  baseline_protocol,comparison_protocol,baseline_search,comparison_search,
  baseline_status,comparison_status,
  baseline->>'complete' AS baseline_lifecycle_complete,comparison->>'complete' AS comparison_lifecycle_complete,
  baseline->'cacheInvalidationReasons' AS baseline_cache_conditions,
  comparison->'cacheInvalidationReasons' AS comparison_cache_conditions,
  group_name,key,baseline_value,comparison_value,
  comparison_value-baseline_value AS delta,
  CASE WHEN baseline_value>0 THEN round(100*(1-comparison_value/baseline_value),2) END AS reduction_percent,
  CASE WHEN baseline_value IS NULL OR comparison_value IS NULL THEN 'unknown metric'
    WHEN same_input IS DISTINCT FROM true THEN 'input equality unproven'
    ELSE 'check cache state and hardware before attribution' END AS interpretation
FROM measurements ORDER BY group_name,key;
