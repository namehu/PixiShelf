import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, describe, expect, it } from 'vitest'
import { artworkDedupReviewListGroupsInputSchema, artworkDedupMaintenancePayloadSchema } from '@pixishelf/job-contracts'
import {
  artworkDedupMembers,
  artworkDedupCursor,
  readArtworkDedupCursor,
  prepareArtworkDedupCleanup,
  getArtworkDedupOperation,
  artworkDedupAdvancedOperation
} from '../artwork-dedup-review-service'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `dedup-api-review-${randomUUID()}`
const users: string[] = [],
  artworks: number[] = []
describe('review cursor and release boundary', () => {
  it('accepts a long bound cursor but rejects account, run, version, kind and group reuse', () => {
    const scope = ['actor'.repeat(20), 'run'.repeat(30), 4, 3, 'MEMBERS', 'group'.repeat(20)]
    const cursor = artworkDedupCursor(scope, 73)
    expect(cursor.length).toBeGreaterThan(128)
    expect(
      artworkDedupReviewListGroupsInputSchema.safeParse({
        expectedUserId: 'actor',
        runId: 'run',
        groupId: 'group',
        memberCursor: cursor
      }).success
    ).toBe(true)
    expect(readArtworkDedupCursor(cursor, scope)).toBe(73)
    for (let i = 0; i < scope.length; i++) {
      const changed = [...scope]
      changed[i] = 'other'
      expect(() => readArtworkDedupCursor(cursor, changed)).toThrow('分页范围')
    }
    expect(
      artworkDedupReviewListGroupsInputSchema.safeParse({
        expectedUserId: 'actor',
        runId: 'run',
        cursor: 'a'.repeat(2001)
      }).success
    ).toBe(false)
  })
  it('rejects foreign and unknown FILES artwork scopes while allowing a frozen member with no files', async () => {
    const now = new Date()
    const operation = {
      id: 'operation-a',
      artistId: 1,
      runId: 'run-a',
      runVersion: 1,
      version: 1,
      executionVersion: 1,
      jobId: null,
      mode: 'PREPARE',
      originalAction: 'PREPARE',
      preparePurpose: 'ISOLATION',
      status: 'READY',
      stage: 'DONE',
      createdAt: now,
      updatedAt: now,
      validatedAt: now,
      selectedGroups: 1,
      excludedGroups: 0,
      blockedGroups: 0,
      keepers: 1,
      copies: 1,
      preparedArtworks: 2,
      preparedFiles: 0n,
      logicalBytes: 0n,
      movedFiles: 0n,
      restoredFiles: 0n,
      deletedFiles: 0n,
      requiresOrganizationConfirmation: false,
      backupCheckpointRef: null,
      purgePreviewStatus: null,
      readerToken: null,
      readerState: 'IDLE',
      errorCode: null
    }
    let fileQueries = 0
    const tx = {
      artworkDedupOperation: { findUnique: async () => operation },
      artworkDedupOperationArtwork: {
        findUnique: async ({
          where
        }: {
          where: { operationId_artworkId: { operationId: string; artworkId: number } }
        }) =>
          where.operationId_artworkId.operationId === operation.id && where.operationId_artworkId.artworkId === 1
            ? { artworkId: 1 }
            : null
      },
      artworkDedupOperationFile: {
        findMany: async () => {
          fileQueries++
          return []
        }
      }
    }
    const database = { $transaction: async (body: (tx: unknown) => unknown) => body(tx) }
    for (const artworkId of [2, 999999])
      {await expect(
        getArtworkDedupOperation(
          'actor',
          { expectedUserId: 'actor', operationId: operation.id, preview: { kind: 'FILES', artworkId, limit: 20 } },
          database as never
        )
      ).rejects.toMatchObject({ code: 'CONFLICT' })}
    expect(fileQueries).toBe(0)
    const result = await getArtworkDedupOperation(
      'actor',
      { expectedUserId: 'actor', operationId: operation.id, preview: { kind: 'FILES', artworkId: 1, limit: 20 } },
      database as never
    )
    expect(result.preview).toEqual({ kind: 'FILES', items: [], nextCursor: null })
    expect(fileQueries).toBe(1)
  })
  it('denies switched-account PREPARE and every unreleased advanced mutation before database work', async () => {
    await expect(
      prepareArtworkDedupCleanup('a', {
        expectedUserId: 'b',
        runId: 'r',
        expectedRunVersion: 1,
        expectedReviewRevision: 0,
        idempotencyKey: 'k',
        selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] }
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    for (const mode of ['ISOLATE', 'RESTORE', 'PURGE'] as const)
      {await expect(artworkDedupAdvancedOperation('a', { expectedUserId: 'a' }, mode)).rejects.toMatchObject({
        code: 'FORBIDDEN'
      })}
    await expect(artworkDedupAdvancedOperation('a', { expectedUserId: 'b' }, 'PREPARE', 'PURGE')).rejects.toMatchObject(
      { code: 'FORBIDDEN' }
    )
    expect(
      artworkDedupMaintenancePayloadSchema.safeParse({
        operationId: 'o',
        executionVersion: 1,
        mode: 'PREPARE',
        path: '/private'
      }).success
    ).toBe(false)
  })
})
describe.skipIf(!db)('current account private projection', () => {
  afterAll(async () => {
    if (!db) return
    await db.image.deleteMany({ where: { artworkId: { in: artworks } } })
    await db.artwork.deleteMany({ where: { id: { in: artworks } } })
    await db.userBA.deleteMany({ where: { id: { in: users } } })
    await db.$disconnect()
  })
  it('projects only the current account rating, valid/invalid marks and reading, with a boolean for others', async () => {
    const actor = await db!.userBA.create({
        data: { id: `${prefix}-a`, name: 'a', email: `${prefix}-a@test.invalid` }
      }),
      other = await db!.userBA.create({ data: { id: `${prefix}-b`, name: 'b', email: `${prefix}-b@test.invalid` } })
    users.push(actor.id, other.id)
    const a = await db!.artwork.create({ data: { title: prefix } })
    artworks.push(a.id)
    const image = await db!.image.create({ data: { artworkId: a.id, path: `${prefix}/secret.jpg` } })
    await db!.artworkLike.createMany({
      data: [
        { artworkId: a.id, userId: actor.id, level: 1 },
        { artworkId: a.id, userId: other.id, level: 4 }
      ]
    })
    await db!.mediaMark.createMany({
      data: [
        {
          id: randomUUID(),
          artworkId: a.id,
          userId: actor.id,
          mediaId: image.id,
          artworkTitle: prefix,
          mediaPosition: 1,
          mediaType: 'image',
          bookmarkedAt: new Date()
        },
        {
          id: randomUUID(),
          artworkId: a.id,
          userId: actor.id,
          mediaId: null,
          artworkTitle: prefix,
          mediaPosition: 2,
          mediaType: 'image',
          likedAt: new Date()
        },
        {
          id: randomUUID(),
          artworkId: a.id,
          userId: other.id,
          mediaId: image.id,
          artworkTitle: 'other-private-title',
          mediaPosition: 1,
          mediaType: 'image',
          likedAt: new Date()
        }
      ]
    })
    await db!.artworkReadingSummary.create({
      data: { artworkId: a.id, userId: other.id, stateVersion: 99, lastViewedAt: new Date('2020-01-01') }
    })
    const [result] = await db!.$transaction((tx) => artworkDedupMembers(tx, actor.id, [a.id]))
    expect(result?.ownOrganization).toEqual({
      rating: 1,
      bookmarks: { available: 1, unavailable: 0 },
      likes: { available: 0, unavailable: 1 }
    })
    expect(result?.ownReading).toBeNull()
    expect(result?.otherAccountHasOrganization).toBe(true)
    expect(result?.thumbnailUrl).toBe(`/api/artwork-dedup/cover/${a.id}?expectedUserId=${encodeURIComponent(actor.id)}`)
    const serialized = JSON.stringify(result)
    for (const secret of [other.id, 'other-private-title', 'secret.jpg', '2020-01-01'])
      {expect(serialized).not.toContain(secret)}
    const [switched] = await db!.$transaction((tx) => artworkDedupMembers(tx, other.id, [a.id]))
    expect(switched?.ownOrganization.rating).toBe(4)
    expect(switched?.ownReading?.stateVersion).toBe(99)
  })
})
