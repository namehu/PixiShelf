import type { PrismaClientSingleton } from '@/lib/prisma'

export type ArchiveTransactionClient = Omit<
  PrismaClientSingleton,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

interface RelationshipValue {
  type: 'REPLACES'
  direction: 'OUTBOUND' | 'INBOUND'
  providerKey: string
  externalId: string
}

/**
 * Materialize provider-owned relationships when both source identities have
 * already been archived. Version edges are historical facts, so a later source
 * response that omits an old edge does not erase it.
 */
export async function syncArtworkRelationships(
  tx: ArchiveTransactionClient,
  artworkId: number,
  providerKey: string,
  rawRelationships: unknown
): Promise<void> {
  const relationships = parseRelationships(rawRelationships)
  for (const relationship of relationships) {
    const target = await tx.artworkExternalRef.findUnique({
      where: {
        providerKey_externalId: {
          providerKey: relationship.providerKey,
          externalId: relationship.externalId
        }
      },
      select: { artworkId: true }
    })
    if (!target || target.artworkId === artworkId) continue
    const fromArtworkId = relationship.direction === 'OUTBOUND' ? artworkId : target.artworkId
    const toArtworkId = relationship.direction === 'OUTBOUND' ? target.artworkId : artworkId
    await tx.artworkRelation.upsert({
      where: { fromArtworkId_toArtworkId_type: { fromArtworkId, toArtworkId, type: relationship.type } },
      create: { fromArtworkId, toArtworkId, type: relationship.type, providerKey },
      update: { providerKey }
    })
  }
}

function parseRelationships(value: unknown): RelationshipValue[] {
  if (!Array.isArray(value)) return []
  const result: RelationshipValue[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const relationship = item as Record<string, unknown>
    if (
      relationship.type !== 'REPLACES' ||
      !['OUTBOUND', 'INBOUND'].includes(String(relationship.direction)) ||
      typeof relationship.providerKey !== 'string' ||
      typeof relationship.externalId !== 'string'
    ) {
      continue
    }
    result.push({
      type: 'REPLACES',
      direction: relationship.direction as RelationshipValue['direction'],
      providerKey: relationship.providerKey,
      externalId: relationship.externalId
    })
  }
  return result
}
