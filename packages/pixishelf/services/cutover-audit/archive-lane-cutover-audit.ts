import {
  ARCHIVE_IMPORT_DEFINITION_VERSION,
  JOB_DEFINITION_VERSION,
  JOB_TYPE_VALUES,
  SCAN_AUDIT_APPLY_DEFINITION_VERSION,
  SCAN_DEFINITION_VERSION
} from '@pixishelf/job-contracts'
import type { PrismaClient } from '@prisma/client'
import { createPrismaCutoverAuditReader, type CutoverAuditReader, type RawCutoverAuditCheck } from './cutover-audit'

const OMITTED_DOMAIN_CHECKS = new Set(['system-job-status', 'archive-import-status'])
const WAITING_JOB_STATUSES = new Set(['PENDING', 'PAUSED', 'RETRY_WAIT'])
const SUPPORTED_JOB_TYPES = new Set<string>(JOB_TYPE_VALUES)

type ArchiveLaneAuditClient = Pick<PrismaClient, '$queryRawUnsafe' | '$transaction'>

type CountRow = { count: bigint | number | string }
type JsonRecord = Record<string, unknown>
type JobCompatibilityRow = JsonRecord & {
  type: string
  definitionVersion: number
  status: string
  count: bigint | number | string
}

export function createPrismaArchiveLaneCutoverAuditReader(
  client: ArchiveLaneAuditClient,
  domainReader: CutoverAuditReader = createPrismaCutoverAuditReader(client)
): CutoverAuditReader {
  return {
    async readChecks(sampleLimit) {
      const [domainChecks, infrastructureChecks] = await Promise.all([
        domainReader.readChecks(sampleLimit),
        readInfrastructureChecks(client, sampleLimit)
      ])
      return [...infrastructureChecks, ...domainChecks.filter((check) => !OMITTED_DOMAIN_CHECKS.has(check.key))]
    }
  }
}

async function readInfrastructureChecks(
  client: Pick<ArchiveLaneAuditClient, '$queryRawUnsafe'>,
  sampleLimit: number
): Promise<readonly RawCutoverAuditCheck[]> {
  const [executingJobs, liveLegacyLeases, freshWorkers, executingArchiveImports, jobCompatibilityRows] =
    await Promise.all([
      readCountedCheck(
        client,
        {
          key: 'lane-executing-system-jobs',
          model: 'SystemJob',
          field: 'status',
          blockingValues: ['RUNNING', 'PAUSING', 'CANCELLING'],
          countSql: `SELECT COUNT(*)::bigint AS count FROM "system_jobs" WHERE "status"::text IN ('RUNNING', 'PAUSING', 'CANCELLING')`,
          sampleSql: `SELECT "id", "type", "definitionVersion", "status"::text AS status, "workerId", "heartbeatAt" FROM "system_jobs" WHERE "status"::text IN ('RUNNING', 'PAUSING', 'CANCELLING') ORDER BY "id" ASC LIMIT $1`
        },
        sampleLimit
      ),
      readCountedCheck(
        client,
        {
          key: 'legacy-global-worker-lease',
          model: 'JobResourceLease',
          field: 'resourceKey/expiresAt',
          blockingValues: ['global/background-worker with expiresAt > now'],
          countSql: `SELECT COUNT(*)::bigint AS count FROM "job_resource_leases" WHERE "resourceKey" = 'global/background-worker' AND "expiresAt" > CURRENT_TIMESTAMP`,
          sampleSql: `SELECT "resourceKey", "ownerJobId", "workerId", "expiresAt", "heartbeatAt" FROM "job_resource_leases" WHERE "resourceKey" = 'global/background-worker' AND "expiresAt" > CURRENT_TIMESTAMP ORDER BY "ownerJobId" ASC LIMIT $1`
        },
        sampleLimit
      ),
      readCountedCheck(
        client,
        {
          key: 'fresh-worker-presence',
          model: 'WorkerInstance',
          field: 'status/heartbeatAt',
          blockingValues: ['STARTING', 'READY', 'STOPPING within 90 seconds'],
          countSql: `SELECT COUNT(*)::bigint AS count FROM "worker_instances" WHERE "status"::text IN ('STARTING', 'READY', 'STOPPING') AND "heartbeatAt" >= CURRENT_TIMESTAMP - INTERVAL '90 seconds'`,
          sampleSql: `SELECT "workerId", "status"::text AS status, "serviceVersion", "heartbeatAt" FROM "worker_instances" WHERE "status"::text IN ('STARTING', 'READY', 'STOPPING') AND "heartbeatAt" >= CURRENT_TIMESTAMP - INTERVAL '90 seconds' ORDER BY "workerId" ASC LIMIT $1`
        },
        sampleLimit
      ),
      readCountedCheck(
        client,
        {
          key: 'lane-executing-archive-imports',
          model: 'ArchiveImport',
          field: 'status',
          blockingValues: ['RUNNING', 'CANCELLING'],
          countSql: `SELECT COUNT(*)::bigint AS count FROM "archive_imports" WHERE "status"::text IN ('RUNNING', 'CANCELLING')`,
          sampleSql: `SELECT "id", "systemJobId", "status"::text AS status, "startedAt", "updatedAt" FROM "archive_imports" WHERE "status"::text IN ('RUNNING', 'CANCELLING') ORDER BY "id" ASC LIMIT $1`
        },
        sampleLimit
      ),
      client.$queryRawUnsafe<JobCompatibilityRow[]>(
        `SELECT "type", "definitionVersion", "status"::text AS status, COUNT(*)::bigint AS count FROM "system_jobs" WHERE "status"::text IN ('PENDING', 'PAUSED', 'RETRY_WAIT') GROUP BY "type", "definitionVersion", "status" ORDER BY "type", "definitionVersion", "status"`
      )
    ])

  const incompatibleGroups = jobCompatibilityRows.filter(
    (row) =>
      WAITING_JOB_STATUSES.has(row.status) &&
      (!SUPPORTED_JOB_TYPES.has(row.type) || !supportsProductionDefinition(row.type, row.definitionVersion))
  )
  // 运行中任务不直接计入阻塞清单：支持的等待队列定义是为了 cutover 前保障新旧 worker 的可接续性，
  // 已领取并执行中的任务优先由当前实例自行完成或回收，不强制等价迁移。
  const incompatibleCount = incompatibleGroups.reduce((total, row) => total + toCount(row.count), 0)

  return [
    executingJobs,
    liveLegacyLeases,
    freshWorkers,
    executingArchiveImports,
    {
      key: 'unsupported-waiting-job-capability',
      model: 'SystemJob',
      field: 'type/definitionVersion/status',
      blockingValues: ['production Worker capability inventory must support each waiting type/version'],
      count: incompatibleCount,
      samples: incompatibleGroups.slice(0, sampleLimit).map(({ count, ...row }) => ({
        ...row,
        count: toCount(count)
      }))
    }
  ]
}

function supportsProductionDefinition(jobType: string, definitionVersion: number): boolean {
  if (jobType === 'SCAN') {
    return (
      definitionVersion === JOB_DEFINITION_VERSION ||
      definitionVersion === SCAN_DEFINITION_VERSION ||
      definitionVersion === SCAN_AUDIT_APPLY_DEFINITION_VERSION
    )
  }
  if (jobType === 'ARCHIVE_IMPORT') {
    return definitionVersion === JOB_DEFINITION_VERSION || definitionVersion === ARCHIVE_IMPORT_DEFINITION_VERSION
  }
  return definitionVersion === JOB_DEFINITION_VERSION
}

async function readCountedCheck(
  client: Pick<ArchiveLaneAuditClient, '$queryRawUnsafe'>,
  input: {
    key: string
    model: string
    field: string
    blockingValues: readonly string[]
    countSql: string
    sampleSql: string
  },
  sampleLimit: number
): Promise<RawCutoverAuditCheck> {
  const [countRows, samples] = await Promise.all([
    client.$queryRawUnsafe<CountRow[]>(input.countSql),
    client.$queryRawUnsafe<JsonRecord[]>(input.sampleSql, sampleLimit)
  ])
  return {
    key: input.key,
    model: input.model,
    field: input.field,
    blockingValues: input.blockingValues,
    count: toCount(countRows[0]?.count ?? 0),
    samples
  }
}

function toCount(value: bigint | number | string): number {
  const count =
    typeof value === 'bigint' ? Number(value) : typeof value === 'string' ? Number.parseInt(value, 10) : value
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid cutover audit count: ${String(value)}`)
  return count
}
