import type { PrismaClient } from '@pixishelf/db'

/** Deploy only after the previous version has finished or explicitly cancelled its deletion work. */
export async function assertLegacyDedupDeletionSettled(database: PrismaClient) {
  const [jobs, operations, claims, holds] = await Promise.all([
    database.systemJob.count({
      where: {
        type: 'ARTWORK_DEDUP_MAINTENANCE',
        status: { in: ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] }
      }
    }),
    database.artworkDedupOperation.count({
      where: {
        OR: [
          { readerToken: { not: null } },
          { readerState: { not: 'IDLE' } },
          {
            status: { notIn: ['CANCELLED', 'DELETED', 'RESTORED', 'PURGED'] },
            OR: [
              { deleteStartedAt: { not: null } },
              { movedFiles: { gt: 0 } },
              { restoredFiles: { gt: 0 } },
              { deletedFiles: { gt: 0 } }
            ]
          }
        ]
      }
    }),
    database.artworkDedupClaim.count(),
    database.artworkDedupSourceIdentity.count({ where: { status: 'HOLD' } })
  ])
  if (jobs || operations || claims || holds) {
    throw new Error(
      `Legacy dedup deletion must be settled with the previous version before upgrade (jobs=${jobs}, operations=${operations}, claims=${claims}, holds=${holds}). See docs/operations/runbooks/dedup-shared-deletion-upgrade.md`
    )
  }
}
