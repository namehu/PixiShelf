import type { Prisma } from '@pixishelf/db'
export const PIXIV_IMPORT_MARK_READ_KEY = 'pixiv_import_mark_read'
/** Called after layout publication, only for newly created works. No visit is fabricated. */
export async function initializePixivImportReading(tx: Prisma.TransactionClient, artworkId: number) {
  const accounts = await tx.userSetting.findMany({
    where: { key: PIXIV_IMPORT_MARK_READ_KEY, type: 'boolean', value: 'true' },
    select: { userId: true }
  })
  if (!accounts.length) return
  const artwork = await tx.artwork.findUniqueOrThrow({ where: { id: artworkId }, select: { logicalMediaCount: true } })
  if (artwork.logicalMediaCount === 0) return
  await tx.artworkReadingProgress.createMany({
    data: accounts.map(({ userId }) => ({ userId, artworkId, completed: true, stateVersion: 1 }))
  })
}
