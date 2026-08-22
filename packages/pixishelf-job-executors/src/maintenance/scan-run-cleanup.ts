import { SINGLETON_JOB_ADVISORY_LOCK_NAMESPACE } from '@pixishelf/job-contracts'
import type { Prisma } from '@pixishelf/db'
import type { MaintenanceOperationInput } from './types.ts'
import { throwIfMaintenanceAborted } from './types.ts'

export const SCAN_RUN_RETENTION_MAX_AGE_DAYS = 180
export const SCAN_RUN_RETENTION_MAX_RUNS_PER_TYPE = 100
export const SCAN_RUN_DELETE_BATCH_SIZE = 200

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'] as const
const TERMINAL_JOB_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'] as const
const SCAN_RUN_TYPES = ['PIXIV', 'LOCAL_IMPORT', 'LOCAL_CREATE', 'BATCH_IMPORT'] as const
const SCAN_SINGLETON_LOCK_KEY = 'SCAN'

export interface ScanRunCleanupResult {
  deletedRuns: number
  expiredRuns: number
  overflowRuns: number
}

interface DeleteScanRunBatchResult {
  blockedIds: string[]
  deletedCount: number
}

function withExcludedIds(where: Prisma.ScanRunWhereInput, excludedIds: Set<string>): Prisma.ScanRunWhereInput {
  if (excludedIds.size === 0) return where
  return { AND: [where, { id: { notIn: [...excludedIds] } }] }
}

function isTerminalChild(child: { status: string; systemJob: { status: string } | null }): boolean {
  return (
    (TERMINAL_STATUSES as readonly string[]).includes(child.status) &&
    (child.systemJob === null || (TERMINAL_JOB_STATUSES as readonly string[]).includes(child.systemJob.status))
  )
}

async function deleteScanRunBatch(
  input: MaintenanceOperationInput,
  candidateIds: string[],
  safetyWhere: Prisma.ScanRunWhereInput
): Promise<DeleteScanRunBatchResult> {
  return input.mutate(async (transaction) => {
    await transaction.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock($1::integer, hashtext($2::text))::text AS "lock"',
      SINGLETON_JOB_ADVISORY_LOCK_NAMESPACE,
      SCAN_SINGLETON_LOCK_KEY
    )

    // Recheck after taking the producer's singleton lock. If an AUDIT_APPLY
    // operation won the race, its non-terminal child protects the evidence run.
    const candidates = await transaction.scanRun.findMany({
      where: { AND: [{ id: { in: candidateIds } }, safetyWhere] },
      select: { id: true, operationKind: true }
    })
    const auditParentIds = candidates
      .filter(({ operationKind }) => operationKind === 'CONSISTENCY_AUDIT')
      .map(({ id }) => id)
    const children =
      auditParentIds.length === 0
        ? []
        : await transaction.scanRun.findMany({
            where: { operationKind: 'AUDIT_APPLY', sourceAuditRunId: { in: auditParentIds } },
            select: {
              id: true,
              sourceAuditRunId: true,
              status: true,
              systemJob: { select: { status: true } }
            }
          })

    const blockedParentIds = new Set(
      children.filter((child) => !isTerminalChild(child)).map(({ sourceAuditRunId }) => sourceAuditRunId!)
    )
    const deletableIds = new Set(
      candidates
        .filter(({ id, operationKind }) => operationKind !== 'AUDIT_APPLY' && !blockedParentIds.has(id))
        .map(({ id }) => id)
    )
    for (const child of children) {
      if (!blockedParentIds.has(child.sourceAuditRunId!) && isTerminalChild(child)) {
        deletableIds.add(child.id)
      }
    }

    const deleted =
      deletableIds.size === 0
        ? { count: 0 }
        : await transaction.scanRun.deleteMany({
            where: { id: { in: [...deletableIds] }, status: { in: [...TERMINAL_STATUSES] } }
          })
    const recheckedIds = new Set(candidates.map(({ id }) => id))
    const preservedApplyIds = candidates
      .filter(({ id, operationKind }) => operationKind === 'AUDIT_APPLY' && !deletableIds.has(id))
      .map(({ id }) => id)
    return {
      deletedCount: deleted.count,
      blockedIds: [...blockedParentIds, ...preservedApplyIds, ...candidateIds.filter((id) => !recheckedIds.has(id))]
    }
  })
}

export async function cleanupScanRunHistory(
  input: MaintenanceOperationInput & { now?: Date; maxAgeDays?: number; maxRunsPerType?: number }
): Promise<ScanRunCleanupResult> {
  const now = input.now ?? new Date()
  const maxAgeDays = input.maxAgeDays ?? SCAN_RUN_RETENTION_MAX_AGE_DAYS
  const maxRunsPerType = input.maxRunsPerType ?? SCAN_RUN_RETENTION_MAX_RUNS_PER_TYPE
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1) throw new Error('Scan run maxAgeDays must be positive')
  if (!Number.isInteger(maxRunsPerType) || maxRunsPerType < 1) {
    throw new Error('Scan run maxRunsPerType must be positive')
  }
  const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1_000)
  let expiredRuns = 0
  let overflowRuns = 0

  await input.progress({ percentage: 2, stage: 'EXPIRY', message: '正在清理过期扫描历史...' })
  const expiryExcludedIds = new Set<string>()
  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const expiryWhere: Prisma.ScanRunWhereInput = {
      status: { in: [...TERMINAL_STATUSES] },
      finishedAt: { lt: cutoff }
    }
    const batch = await input.database.scanRun.findMany({
      where: withExcludedIds(expiryWhere, expiryExcludedIds),
      orderBy: [{ finishedAt: 'asc' }, { id: 'asc' }],
      take: SCAN_RUN_DELETE_BATCH_SIZE,
      select: { id: true }
    })
    if (batch.length === 0) break
    const deleted = await deleteScanRunBatch(
      input,
      batch.map(({ id }) => id),
      expiryWhere
    )
    deleted.blockedIds.forEach((id) => expiryExcludedIds.add(id))
    expiredRuns += deleted.deletedCount
    await input.progress({
      percentage: Math.min(45, 2 + Math.floor(expiredRuns / SCAN_RUN_DELETE_BATCH_SIZE) * 2),
      stage: 'EXPIRY',
      message: `已删除 ${expiredRuns} 条过期扫描历史`,
      data: { expiredRuns, overflowRuns }
    })
    if (deleted.deletedCount === 0 && deleted.blockedIds.length === 0) break
  }

  for (let index = 0; index < SCAN_RUN_TYPES.length; index += 1) {
    const type = SCAN_RUN_TYPES[index]!
    const overflowExcludedIds = new Set<string>()
    while (true) {
      throwIfMaintenanceAborted(input.signal)
      const overflowWhere: Prisma.ScanRunWhereInput = {
        type,
        status: { in: [...TERMINAL_STATUSES] }
      }
      const batch = await input.database.scanRun.findMany({
        where: withExcludedIds(overflowWhere, overflowExcludedIds),
        orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }, { id: 'desc' }],
        skip: maxRunsPerType,
        take: SCAN_RUN_DELETE_BATCH_SIZE,
        select: { id: true }
      })
      if (batch.length === 0) break
      const deleted = await deleteScanRunBatch(
        input,
        batch.map(({ id }) => id),
        overflowWhere
      )
      deleted.blockedIds.forEach((id) => overflowExcludedIds.add(id))
      overflowRuns += deleted.deletedCount
      await input.progress({
        percentage: Math.min(95, 50 + Math.floor(((index + 1) / SCAN_RUN_TYPES.length) * 45)),
        stage: 'OVERFLOW',
        message: `正在限制 ${type} 扫描历史数量，已额外删除 ${overflowRuns} 条`,
        data: { expiredRuns, overflowRuns, type }
      })
      if (deleted.deletedCount === 0 && deleted.blockedIds.length === 0) break
    }
  }

  throwIfMaintenanceAborted(input.signal)
  const deletedRuns = expiredRuns + overflowRuns
  await input.progress({
    percentage: 100,
    stage: 'COMPLETED',
    message: `扫描历史清理完成，共删除 ${deletedRuns} 条`,
    data: { expiredRuns, overflowRuns }
  })
  return { deletedRuns, expiredRuns, overflowRuns }
}
