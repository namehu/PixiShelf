import type { Prisma } from '@pixishelf/db'
import { groupLogicalMedia } from '@pixishelf/job-contracts'

export const PIXIV_IMPORT_MARK_READ_KEY = 'pixiv_import_mark_read'

/** Called only for a newly created artwork, inside its unpublished scan transaction. */
export async function initializePixivImportReading(tx: Prisma.TransactionClient, artworkId: number) {
  const accounts = await tx.userSetting.findMany({
    where: { key: PIXIV_IMPORT_MARK_READ_KEY, type: 'boolean', value: 'true' },
    select: { userId: true }
  })
  if (accounts.length === 0) return

  const images = await tx.image.findMany({
    where: { artworkId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, path: true, mediaType: true }
  })
  const totalCount = groupLogicalMedia(images).length
  if (totalCount === 0) return

  for (const { userId } of accounts) {
    await tx.artworkReadMedia.createMany({
      data: images.map(({ id: mediaId }) => ({ userId, artworkId, mediaId })),
      skipDuplicates: true
    })
    await tx.artworkReadingSummary.create({
      data: { userId, artworkId, seenCount: totalCount, totalCount, stateVersion: 1 }
    })
  }
}
