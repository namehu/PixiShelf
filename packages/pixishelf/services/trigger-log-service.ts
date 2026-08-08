import 'server-only'

import { prisma } from '@/lib/prisma'

export const TRIGGER_LOG_RETENTION_DAYS = 30

export interface TriggerLogCleanupResult {
  deletedLogs: number
  retentionDays: number
  cutoff: string
}

export async function cleanupTriggerLogs(
  options: { retentionDays?: number; now?: Date } = {}
): Promise<TriggerLogCleanupResult> {
  const retentionDays = options.retentionDays ?? TRIGGER_LOG_RETENTION_DAYS
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error('Trigger log retention days must be a positive integer')
  }

  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const result = await prisma.triggerLog.deleteMany({
    where: { created_at: { lt: cutoff } }
  })

  return {
    deletedLogs: result.count,
    retentionDays,
    cutoff: cutoff.toISOString()
  }
}
