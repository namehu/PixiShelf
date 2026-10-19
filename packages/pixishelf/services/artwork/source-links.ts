import 'server-only'

import type { Prisma } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import { archiveTaskSourceUrl } from '@/services/archive/archive-task-source-service'

export interface ArtworkSourceLink {
  id: string
  label: string
  href: string
}

const sourceSelect = {
  id: true,
  artworkId: true,
  providerKey: true,
  externalId: true,
  canonicalUrl: true,
  artwork: { select: { deletedAt: true, archiveLifecycleState: true } }
} as const

type Source = Prisma.ArtworkExternalRefGetPayload<{ select: typeof sourceSelect }>

function sourceUrl(source: Source, artworkId: number): string | null {
  if (
    source.artworkId !== artworkId ||
    source.artwork.deletedAt !== null ||
    source.artwork.archiveLifecycleState !== 'ACTIVE'
  ) {
    return null
  }
  return archiveTaskSourceUrl(source)
}

export async function getArtworkSourceLinks(artworkId: number): Promise<ArtworkSourceLink[]> {
  const sources = await prisma.artworkExternalRef.findMany({
    where: { artworkId, artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' } },
    select: sourceSelect,
    orderBy: { id: 'asc' }
  })
  return sources.flatMap((source) =>
    sourceUrl(source, artworkId)
      ? [
          {
            id: source.id,
            label: `E-Hentai #${source.externalId}`,
            href: `/api/artworks/${artworkId}/sources/${source.id}`
          }
        ]
      : []
  )
}

export async function getArtworkSourceUrl(artworkId: number, sourceId: string): Promise<string | null> {
  const source = await prisma.artworkExternalRef.findFirst({
    where: { id: sourceId, artworkId, artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' } },
    select: sourceSelect
  })
  return source ? sourceUrl(source, artworkId) : null
}
