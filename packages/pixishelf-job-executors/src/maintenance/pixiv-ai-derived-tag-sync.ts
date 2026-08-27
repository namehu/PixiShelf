import type { PixivAiDerivedTagSyncPayload } from '@pixishelf/job-contracts'
import {
  PIXIV_AI_GENERATED_TAG,
  getOrCreatePixivAiGeneratedTag,
  resolvePixivAiGenerated
} from '../pixiv-artwork/ai-derived-tag.ts'
import type { MaintenanceOperationInput } from './types.ts'
import { throwIfMaintenanceAborted } from './types.ts'

export const PIXIV_AI_DERIVED_TAG_SYNC_BATCH_SIZE = 500

type Relation = {
  id: number
  artworkId: number
  provenance: 'SOURCE' | 'MANUAL' | 'DERIVED' | 'LEGACY'
  sourceRef: { providerKey: string } | null
}

export interface PixivAiDerivedTagSyncResult {
  dryRun: boolean
  scannedArtworks: number
  aiGeneratedArtworks: number
  nonAiArtworks: number
  unknownAiArtworks: number
  existingDerivedRelations: number
  wouldCreateDerivedRelations: number
  wouldConvertSourceRelations: number
  wouldConvertLegacyRelations: number
  wouldRemoveStaleDerivedRelations: number
  protectedManualRelations: number
  protectedOtherSourceRelations: number
  appliedCreatedRelations: number
  appliedConvertedRelations: number
  appliedRemovedRelations: number
  finalDerivedRelations: number
}

export async function syncPixivAiDerivedTags(
  input: MaintenanceOperationInput & { payload: PixivAiDerivedTagSyncPayload }
): Promise<PixivAiDerivedTagSyncResult> {
  throwIfMaintenanceAborted(input.signal)
  const pixivArtworkWhere = {
    deletedAt: null,
    externalRefs: { some: { providerKey: 'pixiv' } }
  } as const
  const totalArtworks = await input.database.artwork.count({ where: pixivArtworkWhere })
  const existingTag = await input.database.tag.findFirst({
    where: {
      OR: [
        { systemKey: PIXIV_AI_GENERATED_TAG.systemKey },
        { namespace: PIXIV_AI_GENERATED_TAG.namespace, name: PIXIV_AI_GENERATED_TAG.name }
      ]
    },
    select: { id: true }
  })
  const tagId = input.payload.dryRun
    ? (existingTag?.id ?? null)
    : await input.mutate(async (transaction) => (await getOrCreatePixivAiGeneratedTag(transaction)).id)
  const existingDerivedRelations = tagId
    ? await input.database.artworkTag.count({
        where: { tagId, provenance: 'DERIVED', artwork: pixivArtworkWhere }
      })
    : 0
  const result: PixivAiDerivedTagSyncResult = {
    dryRun: input.payload.dryRun,
    scannedArtworks: 0,
    aiGeneratedArtworks: 0,
    nonAiArtworks: 0,
    unknownAiArtworks: 0,
    existingDerivedRelations,
    wouldCreateDerivedRelations: 0,
    wouldConvertSourceRelations: 0,
    wouldConvertLegacyRelations: 0,
    wouldRemoveStaleDerivedRelations: 0,
    protectedManualRelations: 0,
    protectedOtherSourceRelations: 0,
    appliedCreatedRelations: 0,
    appliedConvertedRelations: 0,
    appliedRemovedRelations: 0,
    finalDerivedRelations: existingDerivedRelations
  }
  let cursor = 0

  await input.progress({
    percentage: totalArtworks === 0 ? 100 : 2,
    stage: input.payload.dryRun ? 'AUDITING' : 'RECONCILING',
    message: input.payload.dryRun ? '正在只读核对 Pixiv AI 派生标签' : '正在校准 Pixiv AI 派生标签',
    data: { total: totalArtworks, dryRun: input.payload.dryRun }
  })

  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const artworks = await input.database.artwork.findMany({
      where: { id: { gt: cursor }, ...pixivArtworkWhere },
      orderBy: { id: 'asc' },
      take: PIXIV_AI_DERIVED_TAG_SYNC_BATCH_SIZE,
      select: { id: true, isAiGenerated: true, pixivAiType: true }
    })
    if (artworks.length === 0) break
    cursor = artworks.at(-1)!.id
    const artworkIds = artworks.map(({ id }) => id)
    const relations: Relation[] = tagId
      ? await input.database.artworkTag.findMany({
          where: { artworkId: { in: artworkIds }, tagId },
          select: {
            id: true,
            artworkId: true,
            provenance: true,
            sourceRef: { select: { providerKey: true } }
          }
        })
      : []
    const relationByArtworkId = new Map(relations.map((relation) => [relation.artworkId, relation]))
    const createArtworkIds: number[] = []
    const convertSourceRelationIds: number[] = []
    const convertLegacyRelationIds: number[] = []
    const removeDerivedRelationIds: number[] = []

    for (const artwork of artworks) {
      const isAiGenerated = resolvePixivAiGenerated(artwork.pixivAiType, artwork.isAiGenerated)
      const relation = relationByArtworkId.get(artwork.id)
      result.scannedArtworks += 1
      if (isAiGenerated === true) {
        result.aiGeneratedArtworks += 1
        if (!relation) {
          createArtworkIds.push(artwork.id)
          result.wouldCreateDerivedRelations += 1
        } else if (relation.provenance === 'SOURCE' && relation.sourceRef?.providerKey === 'pixiv') {
          convertSourceRelationIds.push(relation.id)
          result.wouldConvertSourceRelations += 1
        } else if (relation.provenance === 'LEGACY') {
          convertLegacyRelationIds.push(relation.id)
          result.wouldConvertLegacyRelations += 1
        } else if (relation.provenance === 'MANUAL') {
          result.protectedManualRelations += 1
        } else if (relation.provenance === 'SOURCE') {
          result.protectedOtherSourceRelations += 1
        }
      } else if (isAiGenerated === false) {
        result.nonAiArtworks += 1
        if (relation?.provenance === 'DERIVED') {
          removeDerivedRelationIds.push(relation.id)
          result.wouldRemoveStaleDerivedRelations += 1
        }
      } else {
        result.unknownAiArtworks += 1
      }
    }

    if (!input.payload.dryRun && tagId !== null) {
      const applied = await input.mutate(async (transaction) => {
        const created =
          createArtworkIds.length === 0
            ? 0
            : (
                await transaction.artworkTag.createMany({
                  data: createArtworkIds.map((artworkId) => ({ artworkId, tagId, provenance: 'DERIVED' as const })),
                  skipDuplicates: true
                })
              ).count
        const sourceConverted =
          convertSourceRelationIds.length === 0
            ? 0
            : (
                await transaction.artworkTag.updateMany({
                  where: { id: { in: convertSourceRelationIds }, tagId, provenance: 'SOURCE' },
                  data: { provenance: 'DERIVED', sourceRefId: null }
                })
              ).count
        const legacyConverted =
          convertLegacyRelationIds.length === 0
            ? 0
            : (
                await transaction.artworkTag.updateMany({
                  where: { id: { in: convertLegacyRelationIds }, tagId, provenance: 'LEGACY' },
                  data: { provenance: 'DERIVED', sourceRefId: null }
                })
              ).count
        const removed =
          removeDerivedRelationIds.length === 0
            ? 0
            : (
                await transaction.artworkTag.deleteMany({
                  where: { id: { in: removeDerivedRelationIds }, tagId, provenance: 'DERIVED' }
                })
              ).count
        return { created, converted: sourceConverted + legacyConverted, removed }
      })
      result.appliedCreatedRelations += applied.created
      result.appliedConvertedRelations += applied.converted
      result.appliedRemovedRelations += applied.removed
    }

    await input.progress({
      percentage: totalArtworks === 0 ? 100 : Math.min(99, 2 + Math.floor((result.scannedArtworks / totalArtworks) * 97)),
      stage: input.payload.dryRun ? 'AUDITING' : 'RECONCILING',
      message: `已核对 ${result.scannedArtworks}/${totalArtworks} 个 Pixiv 作品`,
      data: {
        total: totalArtworks,
        processed: result.scannedArtworks,
        dryRun: input.payload.dryRun,
        wouldCreate: result.wouldCreateDerivedRelations,
        wouldConvert: result.wouldConvertSourceRelations + result.wouldConvertLegacyRelations,
        wouldRemove: result.wouldRemoveStaleDerivedRelations
      }
    })
  }

  result.finalDerivedRelations = input.payload.dryRun
    ? existingDerivedRelations +
      result.wouldCreateDerivedRelations +
      result.wouldConvertSourceRelations +
      result.wouldConvertLegacyRelations -
      result.wouldRemoveStaleDerivedRelations
    : tagId === null
      ? 0
      : await input.database.artworkTag.count({
          where: { tagId, provenance: 'DERIVED', artwork: pixivArtworkWhere }
        })
  await input.progress({
    percentage: 100,
    stage: 'COMPLETED',
    message: input.payload.dryRun ? 'Pixiv AI 派生标签只读核对完成' : 'Pixiv AI 派生标签校准完成',
    data: { ...result }
  })
  return result
}
