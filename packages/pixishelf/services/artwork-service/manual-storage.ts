import 'server-only'
import type { Prisma } from '@prisma/client'
import { lockArtworkForReading, lockCreatorCatalog } from '@pixishelf/db'
import { resolveCanonicalArtworkStoragePath } from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import { generateLocalStorageKey } from './utils'

export async function assignManualArtworkStorage(
  tx: Prisma.TransactionClient,
  artwork: { id: number; artistId: number | null; storageKey: string | null }
) {
  const storageKey = artwork.storageKey ?? generateLocalStorageKey(artwork.id)
  const storagePath = resolveCanonicalArtworkStoragePath({
    createdVia: 'MANUAL_CREATE',
    artistId: artwork.artistId,
    storageKey,
    artistPixivExternalId: null,
    artworkPixivExternalId: null
  })
  if (!storagePath) throw new Error('无法生成本地作品目录')
  if (artwork.artistId !== null) {
    const artistDirectory = `artist-${artwork.artistId}`
    const mapping = await tx.localImportArtistMapping.findUnique({ where: { artistDirectory } })
    if (mapping && mapping.artistId !== artwork.artistId) throw new Error('本地作品目录已绑定到其他艺术家')
    if (!mapping) await tx.localImportArtistMapping.create({ data: { artistDirectory, artistId: artwork.artistId } })
  }
  return tx.artwork.update({ where: { id: artwork.id }, data: { storageKey, storagePath } })
}

// Repair only empty manual records left by the old creation flow, under the same
// locks as media publication. Existing media and archive paths remain authoritative.
export async function ensureManualArtworkStorage(artworkId: number) {
  return prisma.$transaction(async (tx) => {
    await lockCreatorCatalog(tx as unknown as Prisma.TransactionClient)
    if (!(await lockArtworkForReading(tx, artworkId))) return
    const artwork = await tx.artwork.findUnique({
      where: { id: artworkId, deletedAt: null },
      include: { _count: { select: { images: true } } }
    })
    if (!artwork || artwork.storagePath || artwork.createdVia !== 'MANUAL_CREATE' || artwork.metaSource || artwork._count.images > 0) return
    await assignManualArtworkStorage(tx as unknown as Prisma.TransactionClient, artwork)
  })
}
