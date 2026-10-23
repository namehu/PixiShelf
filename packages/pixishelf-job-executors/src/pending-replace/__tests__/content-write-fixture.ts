import { randomUUID } from 'node:crypto'
import { beginMediaContentPathWrite, beginMediaContentSourceWrite, type PrismaClient } from '@pixishelf/db'
import type { ExecutorMediaWrite } from '../../scan/media-content-write.ts'

export async function contentWriteFixture(database: PrismaClient, artworkId: number): Promise<ExecutorMediaWrite> {
  const owner = { ownerUserId: null, sessionId: randomUUID(), sessionVersion: 1n, execution: null }
  const writeToken = randomUUID()
  return database.$transaction(async (transaction) => {
    const started = await beginMediaContentPathWrite(transaction, {
      directory: {
        logicalRoot: 'source-media:v1',
        rootIdentity: 'a'.repeat(64),
        relativeDirectory: `test-pending-content/${artworkId}`
      },
      scope: { kind: 'DIRECTORY' },
      owner,
      writeToken,
      upload: null,
      parent: null,
      now: new Date()
    })
    if (started.status !== 'READY') throw new Error(`Fixture content gate failed: ${started.status}`)
    const source = await beginMediaContentSourceWrite(transaction, {
      artworkIds: [artworkId],
      imageIds: [],
      writeToken,
      now: new Date()
    })
    return { owner, handles: [started.value], source }
  })
}
export async function cleanupContentWriteFixtures(database: PrismaClient) {
  await database.mediaContentPathWrite.deleteMany({ where: { directory: { rootIdentity: 'a'.repeat(64) } } })
  await database.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: 'a'.repeat(64) } })
}
