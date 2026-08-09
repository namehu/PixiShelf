import { ESource } from '@/enums/ESource'
import logger from '@/lib/logger'
import { prisma } from '@/lib/prisma'

const FORCE_RESET_TRANSACTION_TIMEOUT_MS = 120_000

/**
 * 删除由 Pixiv 扫描器管理的作品数据，同时保留本地作品及共享实体。
 */
export async function clearPixivImportedData(): Promise<number> {
  try {
    logger.info('Starting Pixiv-only database cleanup for force update')

    const removedArtworks = await prisma.$transaction(
      async (tx) => {
        const pixivArtworkFilter = {
          artwork: {
            source: ESource.PIXIV_IMPORTED
          }
        }

        // ArtworkTag 和 Image 需要先显式删除；其余 Artwork 子记录由现有级联外键处理。
        await tx.artworkTag.deleteMany({ where: pixivArtworkFilter })
        await tx.image.deleteMany({ where: pixivArtworkFilter })
        const result = await tx.artwork.deleteMany({
          where: { source: ESource.PIXIV_IMPORTED }
        })

        return result.count
      },
      {
        maxWait: 5_000,
        timeout: FORCE_RESET_TRANSACTION_TIMEOUT_MS
      }
    )

    logger.info('Pixiv-only database cleanup completed successfully', { removedArtworks })
    return removedArtworks
  } catch (error) {
    logger.error('Failed to clear Pixiv imported data:', { error })
    throw new Error(`Database cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
