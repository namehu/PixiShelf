import { z } from 'zod'
import {
  bindDiscoveryCreators,
  cancelDiscoveryCreator,
  discoveryCreatorSummaries,
  editArtworkCreators,
  lockDiscoveryCreators,
  type PrismaClient,
  type DiscoveryIdentity
} from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import { runArchiveBulkOperation } from './archive-bulk-operation'

export const editTaskCreatorsSchema = z
  .object({
    taskId: z.string().trim().min(1).max(128),
    action: z.enum(['ADD', 'REMOVE']),
    artistIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(200)
      .transform((ids) => [...new Set(ids)].sort((a, b) => a - b)),
    requestId: z.string().uuid()
  })
  .strict()

export async function archiveTaskCreatorSummaries(database: PrismaClient, identities: DiscoveryIdentity[]) {
  if (!identities.length) return []
  const [summaries, refs] = await Promise.all([
    discoveryCreatorSummaries(database, identities),
    database.artworkExternalRef.findMany({
      where: { OR: identities.map(({ providerKey, externalId }) => ({ providerKey, externalId })) },
      select: {
        providerKey: true,
        externalId: true,
        artwork: { select: { deletedAt: true, archiveLifecycleState: true } }
      }
    })
  ])
  return summaries.map((summary, index) => {
    const identity = identities[index]!
    const ref = refs.find((row) => row.providerKey === identity.providerKey && row.externalId === identity.externalId)
    return {
      ...summary,
      creatorEditBlockedReason:
        ref && (ref.artwork.deletedAt || ref.artwork.archiveLifecycleState !== 'ACTIVE')
          ? '作品已在回收站或正在清理，请恢复作品后再修改艺术家。'
          : null
    }
  })
}

export async function editArchiveTaskCreators(
  input: z.input<typeof editTaskCreatorsSchema>,
  requestedByUserId: string,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const parsed = editTaskCreatorsSchema.parse(input)
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.requestId,
      requestedByUserId,
      commandType: 'BIND_CREATORS',
      targetType: 'ARCHIVE_IMPORT',
      targetIds: [parsed.taskId],
      requestOptions: { action: parsed.action, artistIds: parsed.artistIds }
    },
    async (tx, taskId) => {
      const identityTask = await tx.archiveImport.findUnique({ where: { id: taskId } })
      if (!identityTask) return { result: 'CONFLICT', message: '归档任务不存在' }
      const identity = { providerKey: identityTask.providerKey, externalId: identityTask.externalId }
      if (identity.providerKey.length > 50 || identity.externalId.length > 120) {
        return { result: 'CONFLICT', message: '此任务的来源身份暂不支持艺术家绑定' }
      }
      await lockDiscoveryCreators(tx, identity)
      // Publication and cleanup may have completed while this request waited for the locks.
      const task = await tx.archiveImport.findUnique({ where: { id: taskId } })
      if (!task || task.cleanupRequestedAt) {
        return { result: 'CONFLICT', message: '归档任务不存在或正在清理，请稍后重试' }
      }
      const ref = await tx.artworkExternalRef.findUnique({
        where: { providerKey_externalId: identity },
        include: { artwork: true }
      })
      if (ref && (ref.artwork.deletedAt || ref.artwork.archiveLifecycleState !== 'ACTIVE')) {
        return { result: 'CONFLICT', message: '作品已在回收站或正在清理，请恢复作品后再修改艺术家。' }
      }
      if ((await tx.artist.count({ where: { id: { in: parsed.artistIds } } })) !== parsed.artistIds.length) {
        return { result: 'CONFLICT', message: '所选艺术家或社团已不存在' }
      }
      if (parsed.action === 'ADD') {
        const metadata = task.normalizedMetadata as { titles?: { display?: string } } | null
        return {
          result: await bindDiscoveryCreators(tx, identity, parsed.artistIds, {
            automatic: false,
            requestedByUserId,
            title: metadata?.titles?.display ?? task.externalId
          })
        }
      }
      if (ref) await editArtworkCreators(tx, ref.artworkId, parsed.artistIds, 'REMOVE')
      const pending = await tx.discoveryPendingCreator.findMany({
        where: { ...identity, artistId: { in: parsed.artistIds } }
      })
      for (const row of pending) await cancelDiscoveryCreator(tx, row.id)
      // Explicit removal also suppresses defaults when a stale dialog targets an already absent member.
      for (const artistId of parsed.artistIds) {
        const key = { ...identity, artistId }
        await tx.discoveryCreatorSuppression.upsert({
          where: { providerKey_externalId_artistId: key },
          create: key,
          update: {}
        })
      }
      return { result: 'APPLIED' }
    },
    { database }
  )
}
