import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { captureArtworkDedupSources, assertArtworkDedupSources } from '../artwork-dedup-claims'
import { reopenArtworkDedupSources } from '../artwork-dedup-source-release'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `release-${randomUUID()}`
describe.skipIf(!db)('source release overlap generations', () => {
  afterAll(() => db?.$disconnect())
  it('holds root coordination until generation invalidation commits before a concurrent capture', async () => {
    const original = await db!.mediaContentDirectoryState.findUnique({
      where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } }
    })
    const identity = {
      kind: 'PATH' as const,
      canonicalPath: `${prefix}/race.jpg`,
      logicalRoot: 'source-media:v1' as const,
      rootIdentity: original?.rootIdentity ?? 'release-race'
    }
    const proof = (await db!.$transaction((tx) => captureArtworkDedupSources(tx, { identities: [identity] })))[0]!
    await db!.artworkDedupSourceIdentity.update({
      where: { id: proof.sourceId },
      data: { status: 'HOLD', ownerOperationId: prefix }
    })
    let signal!: () => void, finish!: () => void
    const reached = new Promise<void>((resolve) => {
      signal = resolve
    })
    const resume = new Promise<void>((resolve) => {
      finish = resolve
    })
    const release = db!.$transaction(async (tx) => {
      await reopenArtworkDedupSources(tx, {
        operationId: prefix,
        sources: [{ sourceId: proof.sourceId, expectedGeneration: proof.generation }]
      })
      signal()
      await resume
    })
    try {
      await reached
      await expect(
        db!.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'")
          return captureArtworkDedupSources(tx, { identities: [identity] })
        })
      ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } })
    } finally {
      finish()
      await release
    }
    try {
      const fresh = (await db!.$transaction((tx) => captureArtworkDedupSources(tx, { identities: [identity] })))[0]!
      expect(fresh.generation).toBe(proof.generation + 1n)
      await expect(db!.$transaction((tx) => assertArtworkDedupSources(tx, { sources: [proof] }))).rejects.toMatchObject(
        { code: 'SOURCE_GENERATION_CHANGED' }
      )
    } finally {
      await db!.artworkDedupSourceIdentity.delete({ where: { id: proof.sourceId } })
      if (!original)
        await db!.mediaContentDirectoryState.deleteMany({
          where: {
            logicalRoot: identity.logicalRoot,
            rootIdentity: identity.rootIdentity,
            relativeDirectory: '',
            writes: { none: {} },
            mediaSources: { none: {} }
          }
        })
    }
  })
  it('invalidates ancestors and descendants atomically without opening other owners or path neighbours', async () => {
    await expect(
      db!.$transaction(async (tx) => {
        const root =
          (
            await tx.mediaContentDirectoryState.findUnique({
              where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } }
            })
          )?.rootIdentity ?? 'release-fixture'
        const identities = [
          { kind: 'DIRECTORY' as const, canonicalPath: prefix },
          { kind: 'DIRECTORY' as const, canonicalPath: `${prefix}/a` },
          { kind: 'PATH' as const, canonicalPath: `${prefix}/a/file.jpg` },
          { kind: 'PATH' as const, canonicalPath: `${prefix}/ab/file.jpg` }
        ].map((identity) => ({ ...identity, logicalRoot: 'source-media:v1' as const, rootIdentity: root }))
        const proofs = []
        for (const identity of identities)
          proofs.push((await captureArtworkDedupSources(tx, { identities: [identity] }))[0]!)
        await tx.artworkDedupSourceIdentity.update({
          where: { id: proofs[2]!.sourceId },
          data: { status: 'HOLD', ownerOperationId: prefix }
        })
        await reopenArtworkDedupSources(tx, {
          operationId: prefix,
          sources: [{ sourceId: proofs[2]!.sourceId, expectedGeneration: proofs[2]!.generation }]
        })
        for (const index of [0, 1, 2])
          await expect(assertArtworkDedupSources(tx, { sources: [proofs[index]!] })).rejects.toMatchObject({
            code: 'SOURCE_GENERATION_CHANGED'
          })
        await expect(assertArtworkDedupSources(tx, { sources: [proofs[3]!] })).resolves.toBeUndefined()
        const parent = await tx.artworkDedupSourceIdentity.findUniqueOrThrow({ where: { id: proofs[1]!.sourceId } })
        await tx.artworkDedupSourceIdentity.update({
          where: { id: parent.id },
          data: { status: 'TOMBSTONE', ownerOperationId: prefix }
        })
        await tx.artworkDedupSourceIdentity.update({
          where: { id: proofs[2]!.sourceId },
          data: { status: 'HOLD', ownerOperationId: 'other-owner' }
        })
        await reopenArtworkDedupSources(tx, {
          operationId: prefix,
          sources: [{ sourceId: parent.id, expectedGeneration: parent.generation }]
        })
        expect(await tx.artworkDedupSourceIdentity.findUnique({ where: { id: proofs[2]!.sourceId } })).toMatchObject({
          status: 'HOLD',
          ownerOperationId: 'other-owner',
          generation: proofs[2]!.generation + 2n
        })
        const before = await tx.artworkDedupSourceIdentity.findMany({
          where: { id: { in: proofs.map((p) => p.sourceId) } },
          orderBy: { id: 'asc' }
        })
        await expect(
          reopenArtworkDedupSources(tx, {
            operationId: prefix,
            sources: [{ sourceId: proofs[2]!.sourceId, expectedGeneration: proofs[2]!.generation + 2n }]
          })
        ).rejects.toMatchObject({ code: 'SOURCE_HELD' })
        expect(
          await tx.artworkDedupSourceIdentity.findMany({
            where: { id: { in: proofs.map((p) => p.sourceId) } },
            orderBy: { id: 'asc' }
          })
        ).toEqual(before)
        throw new Error('rollback synthetic source release')
      })
    ).rejects.toThrow('rollback synthetic source release')
  })
})
