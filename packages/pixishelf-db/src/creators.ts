import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'

export const activeCreatorEvidence = { present: true, excludedAt: null } as const
export const activeCreatorMembership = { evidence: { some: activeCreatorEvidence } } as const
export const visibleCreatorArtwork = { deletedAt: null, archiveLifecycleState: 'ACTIVE' } as const
export const creatorInclude = {
  where: activeCreatorMembership,
  include: {
    artist: { include: { externalRefs: true, localImportMappings: true, sourceTagMappings: true } },
    evidence: { where: activeCreatorEvidence }
  }
} satisfies Prisma.ArtworkArtistFindManyArgs

export function creatorFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export interface SourceCreatorTag {
  namespace: 'artist' | 'group'
  name: string
}

// Raw tags distinguish a known empty list from the old normalizer's missing => [] fallback.
export function readSourceCreatorTags(normalized: unknown, raw: unknown): SourceCreatorTag[] | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>).tags)) return null
  if (!normalized || typeof normalized !== 'object') return null
  const tags = (normalized as Record<string, unknown>).tags
  if (!Array.isArray(tags)) return null
  const result = new Map<string, SourceCreatorTag>()
  for (const tag of tags) {
    if (!tag || typeof tag !== 'object' || typeof tag.namespace !== 'string' || typeof tag.name !== 'string')
      return null
    if (tag.namespace !== 'artist' && tag.namespace !== 'group') continue
    const name = tag.name.trim().toLocaleLowerCase('en-US')
    if (!name) return null
    result.set(tag.namespace + ':' + name, { namespace: tag.namespace, name })
  }
  return [...result.values()].sort((a, b) => (a.namespace + ':' + a.name).localeCompare(b.namespace + ':' + b.name))
}

export async function lockCreatorCatalog(tx: Prisma.TransactionClient) {
  // Source publication, curation and remapping share a short transaction lock.
  await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(7341902118)::text')
}

async function membership(tx: Prisma.TransactionClient, artworkId: number, artistId: number) {
  return tx.artworkArtist.upsert({
    where: { artworkId_artistId: { artworkId, artistId } },
    create: { artworkId, artistId },
    update: {}
  })
}

export async function syncSourceCreators(
  tx: Prisma.TransactionClient,
  artworkId: number,
  sourceRefId: string,
  providerKey: string,
  tags: SourceCreatorTag[] | null,
  complete = true
) {
  if (tags === null) return { known: false, linked: 0 }
  await lockCreatorCatalog(tx)
  const ref = await tx.artworkExternalRef.findUniqueOrThrow({ where: { id: sourceRefId } })
  if (ref.artworkId !== artworkId || ref.providerKey !== providerKey) throw new Error('创作者来源身份已变化')
  if (complete)
    await tx.artworkArtistEvidence.updateMany({
      where: { sourceRefId, provenance: 'SOURCE' },
      data: { present: false }
    })
  for (const tag of tags) {
    const key = { providerKey, namespace: tag.namespace, sourceName: tag.name }
    let mapping = await tx.artistSourceTagMapping.findUnique({ where: { providerKey_namespace_sourceName: key } })
    if (!mapping) {
      const artist = await tx.artist.create({
        data: { name: tag.name, username: tag.name, kind: tag.namespace === 'group' ? 'GROUP' : 'PERSON' }
      })
      mapping = await tx.artistSourceTagMapping.create({ data: { ...key, artistId: artist.id } })
    }
    const relation = await membership(tx, artworkId, mapping.artistId)
    const evidenceKey = 'source:' + sourceRefId + ':tag:' + mapping.id
    await tx.artworkArtistEvidence.upsert({
      where: { membershipId_evidenceKey: { membershipId: relation.id, evidenceKey } },
      create: { membershipId: relation.id, evidenceKey, provenance: 'SOURCE', sourceRefId, tagMappingId: mapping.id },
      update: { present: true }
    })
  }
  return { known: true, linked: tags.length }
}

export async function editArtworkCreators(
  tx: Prisma.TransactionClient,
  artworkId: number,
  artistIds: readonly number[],
  mode: 'SET' | 'ADD' | 'REMOVE' = 'SET'
) {
  await lockCreatorCatalog(tx)
  const ids = [...new Set(artistIds)]
  const artists = await tx.artist.count({ where: { id: { in: ids } } })
  if (artists !== ids.length) throw new Error('所选艺术家或社团已不存在')
  await tx.artwork.findUniqueOrThrow({ where: { id: artworkId, ...visibleCreatorArtwork } })
  if (mode !== 'ADD') {
    await tx.artworkArtistEvidence.updateMany({
      where: { membership: { artworkId, artistId: mode === 'REMOVE' ? { in: ids } : { notIn: ids } } },
      data: { excludedAt: new Date() }
    })
  }
  if (mode !== 'REMOVE')
    for (const artistId of ids) {
      const relation = await membership(tx, artworkId, artistId)
      // Saving an unchanged source member must not claim its ownership.
      const active = await tx.artworkArtistEvidence.count({
        where: { membershipId: relation.id, ...activeCreatorEvidence }
      })
      if (active && mode === 'SET') continue
      await tx.artworkArtistEvidence.updateMany({ where: { membershipId: relation.id }, data: { excludedAt: null } })
      await tx.artworkArtistEvidence.upsert({
        where: { membershipId_evidenceKey: { membershipId: relation.id, evidenceKey: 'manual' } },
        create: { membershipId: relation.id, evidenceKey: 'manual', provenance: 'MANUAL' },
        update: { present: true, excludedAt: null }
      })
    }
}

export async function remapCreatorTag(
  tx: Prisma.TransactionClient,
  mappingId: string,
  artistId: number,
  expectedVersion: number
) {
  await lockCreatorCatalog(tx)
  const mapping = await tx.artistSourceTagMapping.findUniqueOrThrow({ where: { id: mappingId } })
  if (mapping.version !== expectedVersion) throw new Error('来源映射已变化，请重新预览')
  const target = await tx.artist.findUniqueOrThrow({ where: { id: artistId } })
  if (target.kind !== (mapping.namespace === 'group' ? 'GROUP' : 'PERSON')) throw new Error('艺术家和社团不能互相映射')
  // Move evidence as a set; large source catalogs must not issue one query per artwork.
  await tx.$executeRawUnsafe(
    'INSERT INTO artwork_artists (id, "artworkId", "artistId") SELECT md5(random()::text || clock_timestamp()::text || m."artworkId"::text), m."artworkId", $2 FROM artwork_artist_evidence e JOIN artwork_artists m ON m.id=e."membershipId" WHERE e."tagMappingId"=$1 GROUP BY m."artworkId" ON CONFLICT ("artworkId", "artistId") DO NOTHING',
    mappingId,
    artistId
  )
  const count = await tx.$executeRawUnsafe(
    'UPDATE artwork_artist_evidence e SET "membershipId"=target.id, "updatedAt"=now() FROM artwork_artists old, artwork_artists target WHERE e."tagMappingId"=$1 AND old.id=e."membershipId" AND target."artworkId"=old."artworkId" AND target."artistId"=$2',
    mappingId,
    artistId
  )
  await tx.artistSourceTagMapping.update({ where: { id: mappingId }, data: { artistId, version: { increment: 1 } } })
  return { previousArtistId: mapping.artistId, artistId, count }
}
