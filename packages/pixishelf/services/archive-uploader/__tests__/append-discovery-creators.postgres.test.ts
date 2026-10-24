import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@pixishelf/db'

vi.mock('server-only', () => ({}))
import { createArchiveTitleSource } from '../archive-uploader-service'
import { appendDiscoveryCreators } from '../discovery-creator-service'
import { ARTIST_SELECT } from '@/schemas/models/artists'
import { ArtistResponseDto } from '@/schemas/artist.dto'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `artist-source-append-${randomUUID()}`
describe.skipIf(!url)('append source creators PostgreSQL', () => {
  afterAll(async () => {
    if (!db) {
      return
    }
    await db.archiveUploaderSource.deleteMany({ where: { displayName: prefix } })
    await db.artist.deleteMany({ where: { name: { startsWith: prefix } } })
    await db.$disconnect()
  })
  it('deduplicates concurrent creation, preserves the winner, and unions concurrent appends without scheduling work', async () => {
    const artists = await Promise.all(
      [1, 2, 3].map((number) => db!.artist.create({ data: { name: `${prefix}-${number}` } }))
    )
    const sources = await Promise.all(
      artists
        .slice(0, 2)
        .map((artist) =>
          createArchiveTitleSource({ displayName: prefix, keyword: prefix, artistIds: [artist.id] }, { database: db! })
        )
    )
    expect(new Set(sources.map(({ id }) => id)).size).toBe(1)
    const sourceId = sources[0]!.id
    expect(await db!.discoverySourceCreator.count({ where: { sourceId } })).toBe(1)
    await db!.archiveUploaderSource.update({ where: { id: sourceId }, data: { status: 'ARCHIVED' } })
    await Promise.all(
      artists.map(({ id }) => appendDiscoveryCreators({ sourceId, artistIds: [id], expectedRulesVersion: 1 }, db!))
    )
    await appendDiscoveryCreators({ sourceId, artistIds: artists.map(({ id }) => id), expectedRulesVersion: 1 }, db!)
    expect(
      (await db!.discoverySourceCreator.findMany({ where: { sourceId }, orderBy: { artistId: 'asc' } })).map(
        ({ artistId }) => artistId
      )
    ).toEqual(artists.map(({ id }) => id).sort((a, b) => a - b))
    expect((await db!.archiveUploaderSource.findUniqueOrThrow({ where: { id: sourceId } })).status).toBe('ARCHIVED')
    const dto = ArtistResponseDto.parse(
      await db!.artist.findUniqueOrThrow({ where: { id: artists[0]!.id }, select: ARTIST_SELECT })
    )
    expect(dto.discoverySources).toEqual([
      { id: sourceId, providerKey: 'e-hentai', sourceKind: 'TITLE_QUERY', displayName: prefix, status: 'ARCHIVED' }
    ])
    expect(await db!.archiveUploaderScanRun.count({ where: { sourceId } })).toBe(0)
    expect(await db!.discoveryPendingCreator.count({ where: { artistId: { in: artists.map(({ id }) => id) } } })).toBe(
      0
    )
    expect(await db!.artworkArtist.count({ where: { artistId: { in: artists.map(({ id }) => id) } } })).toBe(0)
  })
  it('rejects stale rules and merged artists without adding any bindings', async () => {
    const rollback = new Error('rollback merged artist fixture')
    await expect(
      db!.$transaction(async (tx) => {
        // Merged artists are immutable; roll back this fixture instead of bypassing database guards.
        const transactionalDatabase = {
          archiveUploaderSource: tx.archiveUploaderSource,
          $transaction: async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx)
        } as unknown as PrismaClient
        const target = await tx.artist.create({ data: { name: `${prefix}-target` } })
        const merged = await tx.artist.create({
          data: { name: `${prefix}-merged`, mergedIntoId: target.id, mergedAt: new Date() }
        })
        const source = await createArchiveTitleSource(
          { displayName: prefix, keyword: `${prefix}-invalid` },
          { database: transactionalDatabase }
        )
        await expect(
          appendDiscoveryCreators(
            { sourceId: source.id, artistIds: [target.id], expectedRulesVersion: 2 },
            transactionalDatabase
          )
        ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
        await expect(
          appendDiscoveryCreators(
            { sourceId: source.id, artistIds: [merged.id], expectedRulesVersion: 1 },
            transactionalDatabase
          )
        ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
        expect(await tx.discoverySourceCreator.count({ where: { sourceId: source.id } })).toBe(0)
        throw rollback
      })
    ).rejects.toBe(rollback)
  })
})
