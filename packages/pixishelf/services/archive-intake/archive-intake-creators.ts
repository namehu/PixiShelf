import type { Prisma } from '@pixishelf/db'
import { z } from 'zod'
import { ArchiveError } from '@/services/archive/errors'

export const intakeArtistIdsSchema = z
  .array(z.number().int().positive())
  .min(1, '请选择或创建本站艺术家')
  .max(200)
  .transform((ids) => [...new Set(ids)].sort((a, b) => a - b))

// Called under the creator lock, only when at least one new intake item was accepted.
export async function captureIntakeCreators(
  tx: Prisma.TransactionClient,
  origin?: { id: string | null; displayName?: string },
  selectedIds?: number[]
) {
  const source = origin?.id
    ? await tx.archiveUploaderSource.findUniqueOrThrow({
        where: { id: origin.id },
        select: {
          id: true,
          displayName: true,
          defaultCreators: { select: { artistId: true }, orderBy: { artistId: 'asc' } }
        }
      })
    : null
  const assignedArtistIds = source?.defaultCreators.length
    ? source.defaultCreators.map((row) => row.artistId)
    : selectedIds
  if (!assignedArtistIds?.length) throw new ArchiveError('STATE_CONFLICT', '请选择或创建本站艺术家后加入收件箱')
  if (
    (await tx.artist.count({ where: { id: { in: assignedArtistIds }, mergedIntoId: null } })) !==
    assignedArtistIds.length
  ) {
    throw new ArchiveError('STATE_CONFLICT', '所选艺术家已不存在或已合并，请重新选择')
  }
  if (source && !source.defaultCreators.length) {
    await tx.discoverySourceCreator.createMany({
      data: assignedArtistIds.map((artistId) => ({ sourceId: source.id, artistId }))
    })
  }
  return {
    localCreatorsOnly: true,
    assignedArtistIds,
    creatorSourceId: source?.id ?? null,
    creatorSourceName: source?.displayName ?? origin?.displayName ?? null
  }
}
