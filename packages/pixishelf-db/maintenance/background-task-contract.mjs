export const phase1Migration = '20261007100000_background_task_retirement_read_model'
export const phase2Migration = '20261011000000_background_task_retirement_contract'
export const contractChecks = {
  system_jobs_legacy_terminal_check: `"definitionVersion" <> 0 OR status IN ('COMPLETED','FAILED','CANCELLED','SKIPPED')`,
  system_jobs_central_lease_check: `"definitionVersion" = 0 OR (CASE WHEN status IN ('RUNNING','PAUSING','CANCELLING') THEN "workerId" IS NOT NULL AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL ELSE "workerId" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL END)`,
  system_jobs_central_skip_check: `"definitionVersion" = 0 OR (CASE WHEN status = 'SKIPPED' THEN "skipReason" IS NOT NULL AND "skippedAt" IS NOT NULL ELSE "skipReason" IS NULL AND "skippedAt" IS NULL END)`,
  system_jobs_central_schedule_check: `"definitionVersion" = 0 OR (CASE WHEN "triggerSource" = 'SCHEDULE' THEN "scheduledForDate" IS NOT NULL ELSE "scheduledTaskId" IS NULL AND "scheduledForDate" IS NULL END)`
}
export const snapshotMismatch = `"definitionVersion" = 0 AND "legacyDisplay" IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'targetImageId',"targetImageId",'targetPath',"targetPath",'mode',mode)`
export const projectionMismatch = `"definitionVersion" = 1 AND type IN ('VIDEO_KEYFRAME_GENERATION','VIDEO_STREAMING_OPTIMIZATION') AND (to_jsonb("targetImageId") IS DISTINCT FROM payload->'imageId' OR "targetPath" IS DISTINCT FROM payload->>'relativePath' OR mode IS DISTINCT FROM payload->>'mode')`
export const invalidSnapshot = `"definitionVersion" = 0 AND NOT COALESCE(jsonb_typeof("legacyDisplay") = 'object' AND "legacyDisplay"->'schemaVersion' = '1'::jsonb AND "legacyDisplay" ?& ARRAY['targetImageId','targetPath','mode'] AND jsonb_typeof("legacyDisplay"->'targetImageId') IN ('number','null') AND jsonb_typeof("legacyDisplay"->'targetPath') IN ('string','null') AND jsonb_typeof("legacyDisplay"->'mode') IN ('string','null'), false)`
