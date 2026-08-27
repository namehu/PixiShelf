import type { Prisma } from '@pixishelf/db'

export const PIXIV_AI_GENERATED_TAG = Object.freeze({
  namespace: 'general',
  name: 'AI生成',
  systemKey: 'pixiv:ai-generated'
})

export type PixivAiGeneratedTagAction =
  | 'CREATED_DERIVED'
  | 'CONVERTED_TO_DERIVED'
  | 'REMOVED_DERIVED'
  | 'SOURCE_DECLARED'
  | 'PROTECTED'
  | 'UNCHANGED'

export function resolvePixivAiGenerated(
  pixivAiType: number | null | undefined,
  legacyValue: boolean | null | undefined
): boolean | null {
  if (pixivAiType === 2) return true
  if (pixivAiType === 1) return false
  return legacyValue ?? null
}

export function normalizeImportedPixivSourceTags(tags: readonly string[], isAiGenerated: boolean | null): string[] {
  return isAiGenerated === true ? tags.filter((tag) => tag !== PIXIV_AI_GENERATED_TAG.name) : [...tags]
}

export async function getOrCreatePixivAiGeneratedTag(transaction: Prisma.TransactionClient): Promise<{ id: number }> {
  const existing = await transaction.tag.findFirst({
    where: {
      OR: [
        { systemKey: PIXIV_AI_GENERATED_TAG.systemKey },
        { namespace: PIXIV_AI_GENERATED_TAG.namespace, name: PIXIV_AI_GENERATED_TAG.name }
      ]
    },
    select: { id: true }
  })
  if (existing) {
    return transaction.tag.update({
      where: { id: existing.id },
      data: { ...PIXIV_AI_GENERATED_TAG, isSystem: true },
      select: { id: true }
    })
  }
  return transaction.tag.create({
    data: { ...PIXIV_AI_GENERATED_TAG, isSystem: true },
    select: { id: true }
  })
}

export async function reconcilePixivAiGeneratedTag(
  transaction: Prisma.TransactionClient,
  input: {
    artworkId: number
    sourceRefId: string
    sourceTags: readonly string[]
    isAiGenerated: boolean | null
  }
): Promise<PixivAiGeneratedTagAction> {
  const sourceDeclaresTag = input.sourceTags.includes(PIXIV_AI_GENERATED_TAG.name)
  if (!sourceDeclaresTag && input.isAiGenerated === null) return 'UNCHANGED'
  let tag = await transaction.tag.findFirst({
    where: {
      OR: [
        { systemKey: PIXIV_AI_GENERATED_TAG.systemKey },
        { namespace: PIXIV_AI_GENERATED_TAG.namespace, name: PIXIV_AI_GENERATED_TAG.name }
      ]
    },
    select: { id: true }
  })
  if (!tag && !sourceDeclaresTag && input.isAiGenerated !== true) return 'UNCHANGED'
  tag ??= await getOrCreatePixivAiGeneratedTag(transaction)

  const relation = await transaction.artworkTag.findUnique({
    where: { artworkId_tagId: { artworkId: input.artworkId, tagId: tag.id } },
    select: { id: true, provenance: true, sourceRefId: true }
  })

  if (sourceDeclaresTag) {
    if (!relation) {
      await transaction.artworkTag.create({
        data: { artworkId: input.artworkId, tagId: tag.id, provenance: 'SOURCE', sourceRefId: input.sourceRefId }
      })
    } else if (relation.provenance === 'DERIVED') {
      await transaction.artworkTag.update({
        where: { id: relation.id },
        data: { provenance: 'SOURCE', sourceRefId: input.sourceRefId }
      })
    } else if (relation.provenance === 'MANUAL' || relation.sourceRefId !== input.sourceRefId) {
      return 'PROTECTED'
    }
    return 'SOURCE_DECLARED'
  }

  if (input.isAiGenerated === true) {
    if (!relation) {
      await transaction.artworkTag.create({
        data: { artworkId: input.artworkId, tagId: tag.id, provenance: 'DERIVED' }
      })
      return 'CREATED_DERIVED'
    }
    if (
      relation.provenance === 'LEGACY' ||
      (relation.provenance === 'SOURCE' && relation.sourceRefId === input.sourceRefId)
    ) {
      await transaction.artworkTag.update({
        where: { id: relation.id },
        data: { provenance: 'DERIVED', sourceRefId: null }
      })
      return 'CONVERTED_TO_DERIVED'
    }
    return relation.provenance === 'DERIVED' ? 'UNCHANGED' : 'PROTECTED'
  }

  if (input.isAiGenerated === false && relation?.provenance === 'DERIVED') {
    await transaction.artworkTag.delete({ where: { id: relation.id } })
    return 'REMOVED_DERIVED'
  }
  return 'UNCHANGED'
}
