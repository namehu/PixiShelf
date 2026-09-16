import { Prisma } from '@prisma/client'
import { activeCreatorMembership, editArtworkCreators, lockCreatorCatalog } from './creators'

export interface DiscoveryIdentity {
  providerKey: string
  externalId: string
}

// Acquire creator, publication, then identity locks before resolving the current artwork.
export async function lockDiscoveryCreators(tx: Prisma.TransactionClient, identity: DiscoveryIdentity) {
  await lockCreatorCatalog(tx)
  await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(7341902117)::text')
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(20260903::integer, hashtext(${identity.providerKey + '\n' + identity.externalId}::text))::text`
  )
}

export async function bindDiscoveryCreators(
  tx: Prisma.TransactionClient,
  identity: DiscoveryIdentity,
  artistIds: readonly number[],
  options: { automatic: boolean; title: string; requestedByUserId?: string }
) {
  const ids = [...new Set(artistIds)]
  const ref = await tx.artworkExternalRef.findUnique({
    where: { providerKey_externalId: identity },
    include: { artwork: true }
  })
  if (ref && (ref.artwork.deletedAt || ref.artwork.archiveLifecycleState !== 'ACTIVE')) return 'SKIPPED' as const
  if (
    options.automatic &&
    (await tx.archiveUploaderIgnoredItem.findUnique({ where: { providerKey_externalId: identity } }))
  )
    return 'SKIPPED' as const
  if ((await tx.artist.count({ where: { id: { in: ids } } })) !== ids.length)
    throw new Error('所选艺术家或社团已不存在')
  const suppressed = options.automatic
    ? await tx.discoveryCreatorSuppression.findMany({ where: { ...identity, artistId: { in: ids } } })
    : []
  const selected = ids.filter((id) => !suppressed.some((row) => row.artistId === id))
  if (!selected.length) return 'SKIPPED' as const
  if (!options.automatic)
    await tx.discoveryCreatorSuppression.deleteMany({ where: { ...identity, artistId: { in: selected } } })
  if (ref) {
    if (options.automatic) {
      for (const artistId of selected) await appendAutomaticCreator(tx, ref.artworkId, artistId)
      await tx.discoveryPendingCreator.deleteMany({ where: { ...identity, artistId: { in: selected } } })
    } else await editArtworkCreators(tx, ref.artworkId, selected, 'ADD')
    return 'APPLIED' as const
  }
  await tx.discoveryPendingCreator.createMany({
    data: selected.map((artistId) => ({
      ...identity,
      artistId,
      title: options.title,
      requestedByUserId: options.requestedByUserId ?? null
    })),
    skipDuplicates: true
  })
  return 'CREATED' as const
}

async function appendAutomaticCreator(tx: Prisma.TransactionClient, artworkId: number, artistId: number) {
  const relation = await tx.artworkArtist.upsert({
    where: { artworkId_artistId: { artworkId, artistId } },
    create: { artworkId, artistId },
    update: {}
  })
  // Automatic defaults never clear a curator's excluded evidence.
  await tx.artworkArtistEvidence.upsert({
    where: { membershipId_evidenceKey: { membershipId: relation.id, evidenceKey: 'manual' } },
    create: { membershipId: relation.id, evidenceKey: 'manual', provenance: 'MANUAL' },
    update: { present: true }
  })
}

export async function consumeDiscoveryCreators(
  tx: Prisma.TransactionClient,
  identity: DiscoveryIdentity,
  artworkId: number
) {
  const pending = await tx.discoveryPendingCreator.findMany({ where: identity })
  const blocked = await tx.discoveryCreatorSuppression.findMany({ where: identity })
  for (const row of pending) {
    if (!blocked.some((item) => item.artistId === row.artistId))
      await appendAutomaticCreator(tx, artworkId, row.artistId)
  }
  await tx.discoveryPendingCreator.deleteMany({ where: identity })
}

export async function cancelDiscoveryCreator(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.discoveryPendingCreator.findUnique({ where: { id } })
  if (!row) return false
  const key = { providerKey: row.providerKey, externalId: row.externalId, artistId: row.artistId }
  await tx.discoveryCreatorSuppression.upsert({
    where: { providerKey_externalId_artistId: key },
    create: key,
    update: {}
  })
  await tx.discoveryPendingCreator.delete({ where: { id } })
  return true
}

export async function discoveryCreatorSummaries(tx: Prisma.TransactionClient, identities: DiscoveryIdentity[]) {
  const [refs, pending] = await Promise.all([
    tx.artworkExternalRef.findMany({
      where: { OR: identities.map(({ providerKey, externalId }) => ({ providerKey, externalId })) },
      include: { artwork: { include: { creators: { where: activeCreatorMembership, include: { artist: true } } } } }
    }),
    tx.discoveryPendingCreator.findMany({
      where: { OR: identities.map(({ providerKey, externalId }) => ({ providerKey, externalId })) },
      include: { artist: true },
      orderBy: { artistId: 'asc' }
    })
  ])
  const option = (artist: { id: number; name: string; kind: 'PERSON' | 'GROUP' }) => ({
    id: artist.id,
    name: artist.name,
    kind: artist.kind
  })
  return identities.map((identity) => {
    const ref = refs.find((row) => row.providerKey === identity.providerKey && row.externalId === identity.externalId)
    return {
      effectiveCreators:
        ref && !ref.artwork.deletedAt && ref.artwork.archiveLifecycleState === 'ACTIVE'
          ? ref.artwork.creators.map((row) => option(row.artist))
          : [],
      pendingCreators: pending
        .filter((row) => row.providerKey === identity.providerKey && row.externalId === identity.externalId)
        .map((row) => ({ ...option(row.artist), pendingId: row.id }))
    }
  })
}
