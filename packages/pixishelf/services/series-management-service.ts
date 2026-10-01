import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { TRPCError } from '@trpc/server'
import { activeCreatorMembership } from '@pixishelf/db'
import { prisma, type PrismaClientSingleton } from '@/lib/prisma'
import { buildVideoPosterUrl, resolveMediaCoverUrl, VIDEO_POSTER_METADATA_SELECT } from '@/lib/media-cover'
import {
  naturalSeriesOrder,
  seriesManagementChangesSchema,
  type SeriesManagementChanges,
  type SeriesArtworkRow
} from '@/schemas/series-management'

const membershipSelect = {
  artworkId: true,
  sortOrder: true,
  sourceOrder: true,
  orderOverridden: true,
  excludedAt: true,
  provenance: true,
  sourceRefId: true,
  artwork: { select: { deletedAt: true } }
} satisfies Prisma.SeriesArtworkSelect
type Membership = Prisma.SeriesArtworkGetPayload<{ select: typeof membershipSelect }>
type SeriesTx = Omit<PrismaClientSingleton, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export function seriesMembershipFingerprint(seriesId: number, rows: Membership[]) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        seriesId,
        [...rows]
          .sort((a, b) => a.artworkId - b.artworkId)
          .map((r) => [
            r.artworkId,
            r.sortOrder,
            r.sourceOrder,
            r.orderOverridden,
            r.excludedAt,
            r.provenance,
            r.sourceRefId,
            r.artwork.deletedAt
          ])
      ])
    )
    .digest('hex')
}

export async function getSeriesManagementDetail(seriesId: number) {
  return prisma.$transaction(
    async (tx) => {
      const series = await tx.series.findUnique({
        where: { id: seriesId },
        include: { externalRefs: { where: { providerKey: 'pixiv' }, take: 1 } }
      })
      if (!series) throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' })
      const rows = await tx.seriesArtwork.findMany({
        where: { seriesId },
        orderBy: [{ sortOrder: 'asc' }, { artworkId: 'asc' }],
        select: {
          ...membershipSelect,
          artwork: {
            select: {
              id: true,
              title: true,
              deletedAt: true,
              thumbnailUrl: true,
              artist: { select: { name: true } },
              creators: { where: activeCreatorMembership, select: { artist: { select: { name: true } } } },
              _count: { select: { images: true } },
              images: {
                take: 1,
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                select: { path: true, mediaType: true, videoMetadata: { select: VIDEO_POSTER_METADATA_SELECT } }
              }
            }
          }
        }
      })
      const artworks: SeriesArtworkRow[] = rows
        .filter((r) => !r.excludedAt && !r.artwork.deletedAt)
        .map((r) => {
          const image = r.artwork.images[0]
          return {
            id: r.artworkId,
            title: r.artwork.title,
            thumbnailUrl:
              resolveMediaCoverUrl(image ? { ...image, posterUrl: buildVideoPosterUrl(image.videoMetadata) } : null) ||
              r.artwork.thumbnailUrl,
            author: r.artwork.creators.map((c) => c.artist.name).join('、') || r.artwork.artist?.name || '',
            mediaCount: r.artwork._count.images,
            sortOrder: r.sortOrder,
            provenance: r.provenance,
            orderOverridden: r.orderOverridden
          }
        })
      const { externalRefs, ...summary } = series
      return {
        ...summary,
        storedCoverImageUrl: series.coverImageUrl,
        coverImageUrl: series.coverImageUrl || artworks[0]?.thumbnailUrl || null,
        pixivSource: externalRefs[0]
          ? { externalId: externalRefs[0].externalId, status: externalRefs[0].status }
          : null,
        artworks,
        membershipFingerprint: seriesMembershipFingerprint(seriesId, rows),
        recoverableMembers: rows
          .filter((r) => r.excludedAt && !r.artwork.deletedAt)
          .map((r) => ({
            artworkId: r.artworkId,
            sortOrder: r.sortOrder,
            provenance: r.provenance,
            orderOverridden: r.orderOverridden
          })),
        maxStoredSortOrder: Math.max(0, ...rows.map((r) => r.sortOrder))
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 }
  )
}

export async function withSeriesMembershipLock<T>(
  seriesId: number,
  candidateIds: number[],
  work: (tx: SeriesTx, rows: Membership[]) => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`
          const existing = await tx.seriesArtwork.findMany({ where: { seriesId }, select: { artworkId: true } })
          const ids = [...new Set([...existing.map((r) => r.artworkId), ...candidateIds])].sort((a, b) => a - b)
          // Non-key locks allow FK checks from maintenance while blocking source publication.
          if (ids.length) {
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM "Artwork" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR NO KEY UPDATE`
            )
          }
          const series = await tx.$queryRaw<
            Array<{ id: number }>
          >`SELECT id FROM "Series" WHERE id = ${seriesId} FOR UPDATE`
          if (!series.length) throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' })
          await tx.$queryRaw`SELECT "artworkId" FROM "SeriesArtwork" WHERE "seriesId" = ${seriesId} ORDER BY "artworkId" FOR UPDATE`
          const rows = await tx.seriesArtwork.findMany({ where: { seriesId }, select: membershipSelect })
          return work(tx, rows)
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 25_000 }
      )
    } catch (error) {
      const e = error as { code?: string; meta?: { code?: string } }
      const retryable =
        e.code === 'P2034' || (e.code === 'P2010' && ['55P03', '40P01', '40001'].includes(e.meta?.code ?? ''))
      if (!retryable || attempt >= 3) throw error
    }
  }
}

export async function saveSeriesManagementChanges(input: SeriesManagementChanges, reorderOnly = false) {
  const parsed = seriesManagementChangesSchema.safeParse(input)
  if (!parsed.success) throw new TRPCError({ code: 'BAD_REQUEST', message: '作品顺序参数无效或 ID 重复' })
  return withSeriesMembershipLock(input.seriesId, input.finalArtworkIds, async (tx, rows) => {
    if (seriesMembershipFingerprint(input.seriesId, rows) !== input.expectedFingerprint) {
      throw new TRPCError({ code: 'CONFLICT', message: '系列成员已变化，请重新加载后整理。当前草稿尚未保存。' })
    }
    const final = new Set(input.finalArtworkIds)
    const active = rows.filter((r) => !r.excludedAt && !r.artwork.deletedAt)
    if (reorderOnly && (active.length !== final.size || active.some((r) => !final.has(r.artworkId)))) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: '排序必须包含全部现有成员' })
    }
    const validCount = await tx.artwork.count({ where: { id: { in: input.finalArtworkIds }, deletedAt: null } })
    if (validCount !== final.size) {
      const existingCount = await tx.artwork.count({ where: { id: { in: input.finalArtworkIds } } })
      if (existingCount !== final.size) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '作品 ID 不存在' })
      }
      throw new TRPCError({ code: 'CONFLICT', message: '所选作品已删除，请重新加载后整理。' })
    }
    const byId = new Map(rows.map((r) => [r.artworkId, r]))
    const maxOrder = Math.max(0, ...rows.map((r) => r.sortOrder))
    const natural = naturalSeriesOrder(input.finalArtworkIds, rows, maxOrder)
    if (!input.explicitReorder && natural.some((id, i) => id !== input.finalArtworkIds[i])) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: '调整顺序必须明确提交本地排序' })
    }
    const removed = rows.filter((r) => !r.excludedAt && !r.artwork.deletedAt && !final.has(r.artworkId))
    await tx.seriesArtwork.updateMany({
      where: {
        seriesId: input.seriesId,
        artworkId: { in: removed.filter((r) => r.provenance === 'SOURCE').map((r) => r.artworkId) }
      },
      data: { excludedAt: new Date() }
    })
    await tx.seriesArtwork.deleteMany({
      where: {
        seriesId: input.seriesId,
        artworkId: { in: removed.filter((r) => r.provenance !== 'SOURCE').map((r) => r.artworkId) }
      }
    })
    const restored = input.finalArtworkIds.filter((id) => byId.get(id)?.excludedAt)
    await tx.seriesArtwork.updateMany({
      where: { seriesId: input.seriesId, artworkId: { in: restored } },
      data: { excludedAt: null }
    })
    const added = input.finalArtworkIds.filter((id) => !byId.has(id))
    if (added.length) {
      await tx.seriesArtwork.createMany({
        data: added.map((id, index) => ({
          seriesId: input.seriesId,
          artworkId: id,
          sortOrder: maxOrder + index + 1,
          provenance: 'MANUAL'
        }))
      })
    }
    if (input.explicitReorder && input.finalArtworkIds.length) {
      const values = input.finalArtworkIds.map((id, index) => Prisma.sql`(${id}::integer, ${index + 1}::integer)`)
      const count = await tx.$executeRaw(
        Prisma.sql`UPDATE "SeriesArtwork" AS m SET "sortOrder" = v.position, "orderOverridden" = true FROM (VALUES ${Prisma.join(values)}) AS v(id, position) WHERE m."seriesId" = ${input.seriesId} AND m."artworkId" = v.id AND m."excludedAt" IS NULL`
      )
      if (count !== final.size) throw new TRPCError({ code: 'CONFLICT', message: '系列成员发生变化，保存已回滚' })
    }
    const after = await tx.seriesArtwork.findMany({ where: { seriesId: input.seriesId }, select: membershipSelect })
    return {
      membershipFingerprint: seriesMembershipFingerprint(input.seriesId, after),
      added: added.length,
      restored: restored.length,
      removed: removed.length
    }
  })
}
