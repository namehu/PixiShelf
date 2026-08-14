import type { MaintenanceOperationInput } from './types.js'
import { throwIfMaintenanceAborted } from './types.js'

export const SCAN_RUN_RETENTION_MAX_AGE_DAYS = 180
export const SCAN_RUN_RETENTION_MAX_RUNS_PER_TYPE = 100
export const SCAN_RUN_DELETE_BATCH_SIZE = 200

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'] as const
const SCAN_RUN_TYPES = ['PIXIV', 'LOCAL_IMPORT', 'LOCAL_CREATE', 'BATCH_IMPORT'] as const

export interface ScanRunCleanupResult {
  deletedRuns: number
  expiredRuns: number
  overflowRuns: number
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
  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const batch = await input.database.scanRun.findMany({
      where: { status: { in: [...TERMINAL_STATUSES] }, finishedAt: { lt: cutoff } },
      orderBy: [{ finishedAt: 'asc' }, { id: 'asc' }],
      take: SCAN_RUN_DELETE_BATCH_SIZE,
      select: { id: true }
    })
    if (batch.length === 0) break
    const deleted = await input.mutate((transaction) =>
      transaction.scanRun.deleteMany({
        where: {
          id: { in: batch.map(({ id }) => id) },
          status: { in: [...TERMINAL_STATUSES] },
          finishedAt: { lt: cutoff }
        }
      })
    )
    expiredRuns += deleted.count
    await input.progress({
      percentage: Math.min(45, 2 + Math.floor(expiredRuns / SCAN_RUN_DELETE_BATCH_SIZE) * 2),
      stage: 'EXPIRY',
      message: `已删除 ${expiredRuns} 条过期扫描历史`,
      data: { expiredRuns, overflowRuns }
    })
  }

  for (let index = 0; index < SCAN_RUN_TYPES.length; index += 1) {
    const type = SCAN_RUN_TYPES[index]!
    while (true) {
      throwIfMaintenanceAborted(input.signal)
      const batch = await input.database.scanRun.findMany({
        where: { type, status: { in: [...TERMINAL_STATUSES] } },
        orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }, { id: 'desc' }],
        skip: maxRunsPerType,
        take: SCAN_RUN_DELETE_BATCH_SIZE,
        select: { id: true }
      })
      if (batch.length === 0) break
      const deleted = await input.mutate((transaction) =>
        transaction.scanRun.deleteMany({
          where: { id: { in: batch.map(({ id }) => id) }, type, status: { in: [...TERMINAL_STATUSES] } }
        })
      )
      overflowRuns += deleted.count
      await input.progress({
        percentage: Math.min(95, 50 + Math.floor(((index + 1) / SCAN_RUN_TYPES.length) * 45)),
        stage: 'OVERFLOW',
        message: `正在限制 ${type} 扫描历史数量，已额外删除 ${overflowRuns} 条`,
        data: { expiredRuns, overflowRuns, type }
      })
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
