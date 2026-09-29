import { randomUUID } from 'node:crypto'
import {
  ArchiveExecutorError,
  enqueueArchiveIntakeItemInTransaction,
  recoverArchiveIntakeEnqueueRace
} from '@pixishelf/job-executors'
import { type PrismaClient } from '@pixishelf/db'
import { z } from 'zod'
import { ArchiveError } from '@/services/archive/errors'
import { prisma } from '@/lib/prisma'
import { runArchiveBulkOperation } from '@/services/archive/archive-bulk-operation'
import { getSystemSettings } from '@/services/setting.service'
import type { SystemSettingsWithDefaults } from '@/schemas/system-setting.dto'

export const enqueueArchiveIntakeManySchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(180),
    items: z
      .array(
        z
          .object({
            itemId: z.string().trim().min(1).max(128),
            quality: z.enum(['ORIGINAL', 'DISPLAY'])
          })
          .strict()
      )
      .min(1)
      .max(100)
      .refine((items) => new Set(items.map((item) => item.itemId)).size === items.length, {
        message: '收件项目不能重复选择'
      })
  })
  .strict()

export interface ArchiveIntakeEnqueueDependencies {
  database?: PrismaClient
  now?: () => Date
  uuid?: () => string
  systemSettings?: SystemSettingsWithDefaults
}

export async function enqueueArchiveIntakeMany(
  input: z.input<typeof enqueueArchiveIntakeManySchema>,
  requestedByUserId: string,
  dependencies: ArchiveIntakeEnqueueDependencies = {}
) {
  const parsed = enqueueArchiveIntakeManySchema.parse(input)
  const database = dependencies.database ?? (prisma as unknown as PrismaClient)
  const now = dependencies.now ?? (() => new Date())
  const uuid = dependencies.uuid ?? randomUUID
  const qualityByItemId = new Map(parsed.items.map((item) => [item.itemId, item.quality]))
  const requestOptions = parsed.items
    .map((item) => ({ itemId: item.itemId, quality: item.quality }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId))
  const settings = dependencies.systemSettings ?? (await getSystemSettings())
  const defaultTagIds = [...new Set(settings.archive_default_tag_ids)].sort((left, right) => left - right)

  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.idempotencyKey,
      requestedByUserId,
      commandType: 'ENQUEUE',
      targetType: 'INTAKE_ITEM',
      targetIds: parsed.items.map((item) => item.itemId),
      requestOptions
    },
    (transaction, itemId) =>
      enqueueArchiveIntakeItemInTransaction(transaction, itemId, {
        quality: qualityByItemId.get(itemId) ?? 'ORIGINAL',
        requestedByUserId,
        timestamp: now(),
        uuid,
        defaultTagIds
      }).catch((error: unknown) => {
        if (error instanceof ArchiveExecutorError) throw new ArchiveError(error.code, error.message, { cause: error })
        throw error
      }),
    { database, now },
    (transaction, itemId, error) =>
      recoverArchiveIntakeEnqueueRace(transaction, itemId, qualityByItemId.get(itemId) ?? 'ORIGINAL', error, now())
  )
}
