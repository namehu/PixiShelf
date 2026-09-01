import type { Prisma } from '@pixishelf/db'
import {
  ARCHIVE_MEDIA_CONCURRENCY_ADVISORY_LOCK_KEY,
  ARCHIVE_MEDIA_CONCURRENCY_DEFAULT,
  ARCHIVE_MEDIA_CONCURRENCY_SETTING_KEY,
  archiveMediaConcurrencySchema
} from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'

const BLOCKING_STATUSES = ['RUNNING', 'PAUSING', 'CANCELLING'] as const

export class ArchiveDownloadSettingsConflictError extends Error {
  constructor(
    message: string,
    readonly blockingSystemJobId: string,
    readonly blockingArchiveImportId: string | null
  ) {
    super(message)
    this.name = 'ArchiveDownloadSettingsConflictError'
  }
}

export interface ArchiveDownloadSettings {
  mediaConcurrency: number
  canUpdate: boolean
  blockingSystemJobId: string | null
  blockingArchiveImportId: string | null
}

export async function getArchiveDownloadSettings(): Promise<ArchiveDownloadSettings> {
  const [setting, blockingJob] = await Promise.all([
    prisma.setting.findUnique({
      where: { key: ARCHIVE_MEDIA_CONCURRENCY_SETTING_KEY },
      select: { value: true }
    }),
    findBlockingArchiveJob(prisma as unknown as Prisma.TransactionClient)
  ])

  return toSettings(setting?.value, blockingJob)
}

export async function updateArchiveDownloadSettings(mediaConcurrency: number): Promise<ArchiveDownloadSettings> {
  const parsed = archiveMediaConcurrencySchema.parse(mediaConcurrency)
  return prisma.$transaction((transaction) =>
    updateArchiveDownloadSettingsInTransaction(transaction as unknown as Prisma.TransactionClient, parsed)
  )
}

export async function updateArchiveDownloadSettingsInTransaction(
  transaction: Prisma.TransactionClient,
  mediaConcurrency: number
): Promise<ArchiveDownloadSettings> {
  const parsed = archiveMediaConcurrencySchema.parse(mediaConcurrency)
  await lockArchiveMediaConcurrency(transaction)
  const blockingJob = await findBlockingArchiveJob(transaction)
  if (blockingJob) {
    throw new ArchiveDownloadSettingsConflictError(
      '归档下载正在执行，当前并发设置不能修改',
      blockingJob.id,
      blockingJob.archiveImport?.id ?? null
    )
  }

  await transaction.setting.upsert({
    where: { key: ARCHIVE_MEDIA_CONCURRENCY_SETTING_KEY },
    update: { value: String(parsed), type: 'number' },
    create: { key: ARCHIVE_MEDIA_CONCURRENCY_SETTING_KEY, value: String(parsed), type: 'number' }
  })

  return toSettings(String(parsed), null)
}

export async function lockArchiveMediaConcurrency(transaction: Prisma.TransactionClient): Promise<void> {
  await transaction.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
    ARCHIVE_MEDIA_CONCURRENCY_ADVISORY_LOCK_KEY
  )
}

type BlockingArchiveJob = {
  id: string
  archiveImport: { id: string } | null
}

async function findBlockingArchiveJob(
  transaction: Pick<Prisma.TransactionClient, 'systemJob'>
): Promise<BlockingArchiveJob | null> {
  return transaction.systemJob.findFirst({
    where: {
      type: 'ARCHIVE_IMPORT',
      status: { in: [...BLOCKING_STATUSES] }
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      archiveImport: { select: { id: true } }
    }
  })
}

function toSettings(value: string | null | undefined, blockingJob: BlockingArchiveJob | null): ArchiveDownloadSettings {
  const parsed = archiveMediaConcurrencySchema.safeParse(value ?? ARCHIVE_MEDIA_CONCURRENCY_DEFAULT)
  return {
    mediaConcurrency: parsed.success ? parsed.data : ARCHIVE_MEDIA_CONCURRENCY_DEFAULT,
    canUpdate: blockingJob === null,
    blockingSystemJobId: blockingJob?.id ?? null,
    blockingArchiveImportId: blockingJob?.archiveImport?.id ?? null
  }
}
