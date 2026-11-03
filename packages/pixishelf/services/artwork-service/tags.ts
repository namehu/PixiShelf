import 'server-only'
import { lockCreatorCatalog, type Prisma } from '@pixishelf/db'
import { TRPCError } from '@trpc/server'
import { prisma } from '@/lib/prisma'
import type { TArtworkTagDto } from '@/schemas/artwork.dto'
import type { ArtworkUpdateTagsInput } from '@/schemas/artwork-tags.dto'
import { assertArtworkDedupAppWrite } from '../artwork-dedup-write-guard'

export async function updateArtworkTags(input: ArtworkUpdateTagsInput): Promise<TArtworkTagDto[]> {
  const { artworkId, addTagIds, removeTagIds, newTagNames } = input

  return prisma.$transaction(async (tx) => {
    await lockCreatorCatalog(tx as unknown as Prisma.TransactionClient)
    await assertArtworkDedupAppWrite(tx, artworkId, 'STRUCTURE')
    const artwork = await tx.artwork.findFirst({
      where: { id: artworkId, deletedAt: null, archiveLifecycleState: 'ACTIVE' },
      select: { id: true }
    })
    if (!artwork) throw new TRPCError({ code: 'NOT_FOUND', message: '作品已不存在或无法编辑，请刷新后重试。' })

    if (addTagIds.length) {
      const existing = await tx.tag.findMany({ where: { id: { in: addTagIds } }, select: { id: true } })
      if (existing.length !== addTagIds.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '部分标签已不存在，请重新搜索后添加。' })
      }
    }

    const addedIds = new Set(addTagIds)
    for (const name of newTagNames) {
      const tag = await tx.tag.upsert({
        where: { namespace_name: { namespace: 'general', name } },
        create: { namespace: 'general', name },
        update: {},
        select: { id: true }
      })
      if (removeTagIds.includes(tag.id)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '同一标签不能同时创建添加和移除。' })
      }
      addedIds.add(tag.id)
    }

    if (removeTagIds.length) {
      await tx.artworkTag.deleteMany({ where: { artworkId, tagId: { in: removeTagIds } } })
    }
    if (addedIds.size) {
      // Existing SOURCE/DERIVED associations keep their ownership and source reference.
      await tx.artworkTag.createMany({
        data: [...addedIds].map((tagId) => ({ artworkId, tagId, provenance: 'MANUAL' as const })),
        skipDuplicates: true
      })
    }

    const associations = await tx.artworkTag.findMany({
      where: { artworkId },
      orderBy: { id: 'asc' },
      select: { tag: { select: { id: true, name: true, name_zh: true } } }
    })
    return associations.map(({ tag }) => tag)
  })
}
