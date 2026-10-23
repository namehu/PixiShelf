import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { captureMediaContentDirectory } from '../media-content-directory'
import {
  assertArtworkContentSnapshot,
  bindMediaContentDirectories,
  captureArtworkContentSnapshot,
  readArtworkContentMembersPage
} from '../media-content-evidence'
import { beginMediaContentPathWrite, beginMediaContentSourceWrite } from '../media-content-writes'
import type { MediaContentResult } from '../media-content-types'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url, log: [{ emit: 'event', level: 'query' }] }) : null
const suite = url ? describe.sequential : describe.skip
let queries: string[] | null = null
db?.$on('query', (event) => {
  queries?.push(event.query)
})
const rollback = new Error('rollback snapshot fixture')
const ready = <T>(result: MediaContentResult<T>) => {
  expect(result.status).toBe('READY')
  if (result.status !== 'READY') throw new Error(result.status)
  return result.value
}
afterAll(async () => {
  await db?.$disconnect()
})

suite('captured artwork snapshot assertion without recounting', () => {
  it.each([
    'unchanged',
    'insert',
    'delete',
    'source write',
    'artwork write',
    'directory write',
    'stale revision',
    'stale epoch'
  ] as const)('preserves the snapshot fence for %s', async (change) => {
    await expect(
      db!.$transaction(async (tx) => {
        const artwork = await tx.artwork.create({ data: { title: `snapshot-${randomUUID()}` } })
        const existingRoot = await tx.mediaContentDirectoryState.findUnique({
          where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } }
        })
        const directory = ready(
          await captureMediaContentDirectory(tx, {
            directory: {
              logicalRoot: 'source-media:v1',
              rootIdentity: existingRoot?.rootIdentity ?? 'snapshot-fixture-root',
              relativeDirectory: `snapshot-${randomUUID()}`
            }
          })
        )
        await tx.image.createMany({
          data: [0, 1].map((i) => ({ artworkId: artwork.id, path: `${directory.relativeDirectory}/${i}.bin` }))
        })
        const snapshot = ready(await captureArtworkContentSnapshot(tx, { artworkId: artwork.id }))
        expect(snapshot.memberCount).toBe(2n)
        const members = ready(
          await readArtworkContentMembersPage(tx, { snapshot, afterImageId: null, limit: 100 })
        ).members
        ready(
          await bindMediaContentDirectories(tx, {
            snapshot,
            bindings: members.map((member) => ({
              imageId: member.imageId,
              expectedSourcePath: member.sourcePath,
              expectedSourceRevision: member.sourceRevision,
              directory
            }))
          })
        )
        const expected = { ...snapshot }
        if (change === 'insert')
          await tx.image.create({ data: { artworkId: artwork.id, path: `${directory.relativeDirectory}/extra.bin` } })
        if (change === 'delete') await tx.image.delete({ where: { id: members[0]!.imageId } })
        if (change === 'source write' || change === 'artwork write')
          await beginMediaContentSourceWrite(tx, {
            artworkIds: change === 'artwork write' ? [artwork.id] : [],
            imageIds: change === 'source write' ? [members[0]!.imageId] : [],
            writeToken: randomUUID(),
            now: new Date()
          })
        if (change === 'directory write')
          ready(
            await beginMediaContentPathWrite(tx, {
              directory,
              scope: { kind: 'DIRECTORY' },
              owner: { ownerUserId: null, sessionId: randomUUID(), sessionVersion: 1n, execution: null },
              writeToken: randomUUID(),
              upload: null,
              parent: null,
              now: new Date()
            })
          )
        if (change === 'stale revision') expected.revision += 1n
        if (change === 'stale epoch') expected.mediaEpoch += 1n
        queries = []
        const result = await assertArtworkContentSnapshot(tx, { snapshot: expected })
        const assertionQueries = queries
        queries = null
        expect(assertionQueries.some((sql) => /\bCOUNT\s*\(/i.test(sql))).toBe(false)
        expect(result).toEqual(
          change === 'unchanged'
            ? { status: 'READY', value: snapshot }
            : {
                status: change === 'artwork write' ? 'WRITING' : 'STALE'
              }
        )
        throw rollback
      })
    ).rejects.toBe(rollback)
  })
})
