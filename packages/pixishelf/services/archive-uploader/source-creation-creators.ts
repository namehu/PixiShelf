import { lockCreatorCatalog, type Prisma } from '@pixishelf/db'
import { ArchiveError } from '@/services/archive/errors'
import { setDiscoveryCreatorsSchema } from './discovery-creator-service'

export const sourceCreationArtistIdsSchema = setDiscoveryCreatorsSchema.shape.artistIds.optional()

export async function validateSourceCreationCreators(tx: Prisma.TransactionClient, artistIds: number[]) {
  if (!artistIds.length) return
  await lockCreatorCatalog(tx)
  const count = await tx.artist.count({ where: { id: { in: artistIds }, mergedIntoId: null } })
  if (count !== artistIds.length) throw new ArchiveError('STATE_CONFLICT', '所选艺术家或社团已不存在，请重新选择。')
}

export function sourceCreationCreators(artistIds: number[] = []) {
  return artistIds.length
    ? { defaultCreators: { create: artistIds.map((id) => ({ artist: { connect: { id } } })) } }
    : {}
}
