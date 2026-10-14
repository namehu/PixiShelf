import { unstable_cache } from 'next/cache'
import { activeCreatorMembership, visibleCreatorArtwork } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import logger from '@/lib/logger'
import { optimizedImageCountSql, toStatisticsCount } from './statistics-queries'

export type StatisticsResult<T> = { ok: true; value: T } | { ok: false }
export type StatisticsRanking = { id: number; name: string; count: number }[]

async function measure<T>(query: string, read: () => Promise<T>): Promise<T> {
  const started = performance.now()
  let success = false
  try {
    const value = await read()
    success = true
    return value
  } catch {
    // Next may log background revalidation failures. Keep its exception safe too.
    throw new Error(`Statistics query failed: ${query}`)
  } finally {
    logger.info('statistics.query', { query, success, durationMs: Math.round(performance.now() - started) })
  }
}

const getBasicCounts = unstable_cache(
  async () => {
    const [artworks, artists, tags] = await Promise.all([
      measure('artworks', () => prisma.artwork.count()),
      measure('artists', () => prisma.artist.count({ where: { mergedIntoId: null } })),
      measure('tags', () => prisma.tag.count())
    ])
    return { artworks, artists, tags }
  },
  ['statistics-basic-v3'],
  { revalidate: 60 }
)

// Opt in only after statistics-diagnostics has verified this database's counters.
// The mode is an argument so switching back never reuses an optimized result.
const getImageCount = unstable_cache(
  async (mode: 'exact' | 'counter') => {
    return measure(`images.${mode}`, async () => {
      if (mode === 'exact') return prisma.image.count()
      const rows = await prisma.$queryRaw<{ count: bigint }[]>(optimizedImageCountSql)
      if (!rows[0]) throw new Error('Missing statistics count')
      return toStatisticsCount(rows[0].count)
    })
  },
  ['statistics-images-v3'],
  { revalidate: 60 }
)

const getTopArtists = unstable_cache(
  async (): Promise<StatisticsRanking> => {
    const memberships = await measure('topArtists.memberships', () =>
      prisma.artworkArtist.groupBy({
        by: ['artistId'],
        where: { artist: { mergedIntoId: null }, ...activeCreatorMembership, artwork: visibleCreatorArtwork },
        _count: { artistId: true },
        orderBy: [{ _count: { artistId: 'desc' } }, { artistId: 'asc' }],
        take: 20
      })
    )
    if (!memberships.length) return []
    const artists = await measure('topArtists.names', () =>
      prisma.artist.findMany({
        where: { id: { in: memberships.map((item) => item.artistId) }, mergedIntoId: null },
        select: { id: true, name: true }
      })
    )
    const names = new Map(artists.map((artist) => [artist.id, artist.name]))
    return memberships.map((item) => ({
      id: item.artistId,
      name: names.get(item.artistId) ?? '未知艺术家',
      count: item._count.artistId
    }))
  },
  ['statistics-artists-v3'],
  { revalidate: 60 }
)

const getTopTags = unstable_cache(
  async (): Promise<StatisticsRanking> => {
    const tags = await measure('topTags', () =>
      prisma.tag.findMany({
        orderBy: [{ artworkCount: 'desc' }, { id: 'asc' }],
        take: 20,
        select: { id: true, name: true, artworkCount: true }
      })
    )
    return tags.map((tag) => ({ id: tag.id, name: tag.name, count: tag.artworkCount }))
  },
  ['statistics-tags-v3'],
  { revalidate: 60 }
)

export function loadStatisticsSections() {
  const started = performance.now()
  let remaining = 4
  let failed = 0
  async function section<T>(name: string, read: () => Promise<T>): Promise<StatisticsResult<T>> {
    const sectionStarted = performance.now()
    let success = false
    try {
      const value = await read()
      success = true
      return { ok: true, value }
    } catch {
      failed += 1
      return { ok: false }
    } finally {
      // No SQL, names, connection strings or error details enter these timing logs.
      logger.info('statistics.section', {
        section: name,
        success,
        durationMs: Math.round(performance.now() - sectionStarted)
      })
      remaining -= 1
      if (remaining === 0) {
        logger.info('statistics.page', { failed, durationMs: Math.round(performance.now() - started) })
      }
    }
  }
  return {
    basic: section('basic', getBasicCounts),
    images: section('images', () =>
      getImageCount(process.env.STATISTICS_IMAGE_COUNT_MODE === 'counter' ? 'counter' : 'exact')
    ),
    artists: section('artists', getTopArtists),
    tags: section('tags', getTopTags)
  }
}
