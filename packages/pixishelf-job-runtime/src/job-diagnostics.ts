import {
  extractJobDiagnostic,
  sanitizeDiagnosticText,
  sanitizeJobDiagnostic,
  type JobDiagnostic,
  type JobDiagnosticInput
} from '@pixishelf/job-contracts'
import type { QueueSqlExecutor } from './queue-repository.ts'

export async function recordJobDiagnostic(
  transaction: QueueSqlExecutor,
  jobId: string,
  input: JobDiagnosticInput,
  now = new Date(),
  structuredDiagnostic?: JobDiagnostic,
  expectedExecutionId?: string
): Promise<void> {
  if (expectedExecutionId !== undefined) {
    const owned = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "system_jobs" WHERE "id"=$1 AND "currentDiagnosticExecutionId"=$2::uuid FOR UPDATE',
      jobId,
      expectedExecutionId
    )
    if (owned.length !== 1) throw new Error('Diagnostic execution identity was superseded')
  }
  const diagnostic = structuredDiagnostic
    ? sanitizeJobDiagnostic(structuredDiagnostic)
    : extractJobDiagnostic(input.error, input)
  const scope = input.scope ?? 'TASK'
  const origin = input.origin ?? 'CURRENT'
  const text = (value: string | undefined, size: number) =>
    value === undefined ? null : sanitizeDiagnosticText(value, size)
  if (!input.key || input.key.length > 240) throw new TypeError('Diagnostic key must contain 1–240 characters')
  // The caller owns a fenced transaction. The row lock also serializes report close and inherited replacement.
  await transaction.$executeRawUnsafe(
    `INSERT INTO "system_job_diagnostic_reports"
    ("id","jobId","attempt","createdAt","expiresAt")
    SELECT "currentDiagnosticExecutionId", "id", "attempt", $2, $2 + INTERVAL '90 days'
    FROM "system_jobs" WHERE "id"=$1 AND "currentDiagnosticExecutionId" IS NOT NULL
    ON CONFLICT ("id") DO NOTHING`,
    jobId,
    now
  )
  if (origin === 'CURRENT') {
    await transaction.$executeRawUnsafe(
      `WITH removed AS (
      DELETE FROM "system_job_diagnostic_items" i USING "system_job_diagnostic_reports" r, "system_jobs" j
      WHERE i."reportId"=r."id" AND j."currentDiagnosticExecutionId"=r."id" AND j."id"=$1
        AND i."key"=$2 AND i."origin"='INHERITED' AND r."status"='OPEN'
      RETURNING i."reportId", i."scope"
    ) UPDATE "system_job_diagnostic_reports" r SET "entryCount"="entryCount"-1,
      "itemCount"="itemCount"-CASE WHEN d."scope"='ITEM' THEN 1 ELSE 0 END,
      "inheritedCount"="inheritedCount"-CASE WHEN d."scope"='ITEM' THEN 1 ELSE 0 END
      FROM removed d WHERE r."id"=d."reportId"`,
      jobId,
      input.key
    )
  }
  await transaction.$executeRawUnsafe(
    `WITH inserted AS (INSERT INTO "system_job_diagnostic_items"
    ("reportId","key","scope","origin","targetType","targetId","targetLabel","stage","code","reasonKey","message","suggestion","evidence","remoteHost","httpStatus","itemAttempt","createdAt")
    SELECT r."id",$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17
    FROM "system_job_diagnostic_reports" r JOIN "system_jobs" j ON j."currentDiagnosticExecutionId"=r."id"
    WHERE j."id"=$1 AND r."status"='OPEN' AND r."expiredAt" IS NULL
    ON CONFLICT ("reportId","key") DO NOTHING RETURNING "reportId","scope","origin"
    ) UPDATE "system_job_diagnostic_reports" r SET "entryCount"="entryCount"+1,
      "itemCount"="itemCount"+CASE WHEN i."scope"='ITEM' THEN 1 ELSE 0 END,
      "currentCount"="currentCount"+CASE WHEN i."scope"='ITEM' AND i."origin"='CURRENT' THEN 1 ELSE 0 END,
      "inheritedCount"="inheritedCount"+CASE WHEN i."scope"='ITEM' AND i."origin"='INHERITED' THEN 1 ELSE 0 END,
      "taskFailure"="taskFailure" OR i."scope"='TASK'
    FROM inserted i WHERE r."id"=i."reportId"`,
    jobId,
    input.key,
    scope,
    origin,
    text(input.targetType, 80),
    text(input.targetId, 240),
    text(input.targetLabel, 500),
    text(input.stage, 80),
    diagnostic.code,
    diagnostic.reasonKey,
    diagnostic.message,
    diagnostic.suggestion,
    JSON.stringify(diagnostic.evidence),
    diagnostic.remoteHost,
    diagnostic.httpStatus,
    input.itemAttempt ?? null,
    now
  )
}

export async function closeJobDiagnosticReport(
  transaction: QueueSqlExecutor,
  jobId: string,
  outcome: string,
  now: Date,
  complete = true
): Promise<void> {
  await transaction.$executeRawUnsafe(
    `UPDATE "system_job_diagnostic_reports" r SET
    "status"='CLOSED',"outcome"=$2,"closedAt"=$3,"expiresAt"=$3 + INTERVAL '90 days',"complete"=$4
    FROM "system_jobs" j WHERE j."id"=$1 AND j."currentDiagnosticExecutionId"=r."id" AND r."status"='OPEN'`,
    jobId,
    outcome,
    now,
    complete
  )
}
