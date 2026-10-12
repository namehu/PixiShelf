import { Prisma, type PrismaClient } from '@pixishelf/db'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { runArchiveBulkOperation } from './archive-bulk-operation'
import { requestArchiveArtworkMaintenanceInTransaction } from './archive-maintenance-service'
import { redactArchiveText } from './archive-redaction'
import type { ArchiveTransactionClient } from './relationships'

export const archiveTrashListSchema = z
  .object({
    search: z.string().trim().max(500).default(''),
    cursor: z.object({ deletedAt: z.coerce.date(), id: z.number().int().positive() }).optional(),
    limit: z.number().int().min(1).max(100).default(50)
  })
  .strict()

export const archiveTrashRestoreSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(180),
    artworkIds: z.array(z.number().int().positive()).min(1).max(100)
  })
  .strict()

export async function listArchiveTrash(
  input: z.input<typeof archiveTrashListSchema>,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const parsed = archiveTrashListSchema.parse(input)
  const base: Prisma.ArtworkWhereInput = { createdVia: 'URL_ARCHIVE', deletedAt: { not: null } }
  const where: Prisma.ArtworkWhereInput = {
    ...base,
    AND: [
      ...(parsed.search
        ? [
            {
              OR: [
                { title: { contains: parsed.search, mode: 'insensitive' as const } },
                { externalRefs: { some: { externalId: { contains: parsed.search, mode: 'insensitive' as const } } } }
              ]
            }
          ]
        : []),
      ...(parsed.cursor
        ? [
            {
              OR: [
                { deletedAt: { lt: parsed.cursor.deletedAt } },
                { deletedAt: parsed.cursor.deletedAt, id: { lt: parsed.cursor.id } }
              ]
            }
          ]
        : [])
    ]
  }
  const [records, count] = await Promise.all([
    database.artwork.findMany({
      where,
      orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
      take: parsed.limit + 1,
      select: {
        id: true,
        title: true,
        deletedAt: true,
        archiveLifecycleState: true,
        externalRefs: { select: { providerKey: true, externalId: true } },
        archiveRevisions: { select: { purgeAfter: true, archiveImportId: true }, orderBy: { createdAt: 'desc' } }
      }
    }),
    database.artwork.count({ where: base })
  ])
  const visible = records.slice(0, parsed.limit)
  const jobs = await Promise.all(
    visible.map((row) =>
      database.systemJob.findFirst({
        where: { type: 'ARCHIVE_MAINTENANCE', payload: { path: ['artworkId'], equals: row.id } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, status: true, message: true, payload: true }
      })
    )
  )
  const now = new Date()
  const items = visible.map((row, index) => {
    const job = jobs[index]
    const deadlines = row.archiveRevisions.map((r) => r.purgeAfter).filter((date): date is Date => date !== null)
    const purgeAfter = deadlines.length ? new Date(Math.max(...deadlines.map(Number))) : null
    const restoreDeadline = deadlines.length ? Math.min(...deadlines.map(Number)) : 0
    const jobActive =
      job && ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'].includes(job.status)
    const purgeActive = jobActive && (job.payload as { action?: string }).action === 'PURGE_ARCHIVE'
    return {
      id: row.id,
      title: row.title,
      deletedAt: row.deletedAt!,
      lifecycleState: row.archiveLifecycleState,
      sources: row.externalRefs,
      purgeAfter,
      taskId: row.archiveRevisions.find((r) => r.archiveImportId)?.archiveImportId ?? null,
      canRestore: row.archiveLifecycleState === 'TRASHED' && restoreDeadline > now.getTime() && !purgeActive,
      canRetry:
        !jobActive &&
        (['TRASHING', 'RESTORING'].includes(row.archiveLifecycleState) ||
          (row.archiveLifecycleState === 'TRASHED' && !!purgeAfter && purgeAfter <= now)),
      maintenance: job ? { id: job.id, status: job.status, message: redactArchiveText(job.message) } : null
    }
  })
  const last = items.at(-1)
  return {
    items,
    count,
    nextCursor: records.length > parsed.limit && last ? { deletedAt: last.deletedAt, id: last.id } : null
  }
}

export async function restoreArchiveTrash(
  input: z.input<typeof archiveTrashRestoreSchema>,
  userId: string,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const parsed = archiveTrashRestoreSchema.parse(input)
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.idempotencyKey,
      requestedByUserId: userId,
      commandType: 'RESTORE_ARCHIVE',
      targetType: 'ARCHIVE_ARTWORK',
      targetIds: parsed.artworkIds.map(String)
    },
    async (tx, targetId) => {
      const result = await requestArchiveArtworkMaintenanceInTransaction(
        {
          artworkId: Number(targetId),
          action: 'RESTORE_ARCHIVE',
          requestedByUserId: userId
        },
        tx as unknown as ArchiveTransactionClient
      )
      return { result: result.reused ? 'REUSED' : 'APPLIED', relatedId: result.jobId, message: '已提交恢复任务' }
    },
    { database }
  )
}
