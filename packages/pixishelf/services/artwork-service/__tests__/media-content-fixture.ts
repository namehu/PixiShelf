import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ContentWriteAuthorization, MediaUploadReceipt } from '@/schemas/media-content.dto'

export const fixtureUser = 'upload-fixture-user'
export function uploadIdentity() {
  return {
    userId: fixtureUser,
    expectedUserId: fixtureUser,
    sessionId: randomUUID(),
    writeToken: randomUUID(),
    requestId: randomUUID()
  }
}
export function fixtureAuthorization(relativePath?: string): ContentWriteAuthorization {
  return {
    sessionId: '40000000-0000-4000-8000-000000000001',
    handle: {
      writeId: 'write-fixture',
      directoryId: 'directory-fixture',
      writeToken: '40000000-0000-4000-8000-000000000002',
      declarationVersion: '1',
      scope: relativePath ? { kind: 'PATH', relativePath } : { kind: 'DIRECTORY' },
      parentWriteId: null
    }
  }
}
export function replacementIdentity() {
  const authorization = fixtureAuthorization()
  return {
    userId: fixtureUser,
    sessionId: authorization.sessionId,
    writeToken: authorization.handle.writeToken,
    authorization
  }
}
export function fixtureReceipt(relativePath = 'fixture.png'): MediaUploadReceipt {
  return {
    expectedUserId: fixtureUser,
    authorization: fixtureAuthorization(relativePath),
    receipt: {
      requestId: '40000000-0000-4000-8000-000000000003',
      chunkIndex: 0,
      offset: '0',
      byteLength: '1',
      sha256: 'a'.repeat(64)
    }
  }
}

// Storage/service unit tests keep real file I/O; this adapter isolates the DB protocol.
// Real claims, CAS, ownership and scan races are covered in media-content-upload.postgres.test.ts.
export function createUploadProtocolMock() {
  const writes = new Map<string, { handle: any; declaredFileSize: bigint; totalChunks: number; lastReceipt: any }>()
  return {
    prisma: {
      $transaction: async (callback: (tx: any) => Promise<unknown>) =>
        callback({ mediaContentPathWrite: { findUnique: async () => null } }),
      mediaContentPathWrite: { findUnique: async () => null }
    },
    begin: async (input: any) => {
      const relativePath = path.relative(input.scanRoot, input.absolutePath).split(path.sep).join('/')
      const auth = fixtureAuthorization(relativePath)
      auth.sessionId = input.sessionId
      auth.handle.writeToken = input.writeToken
      auth.handle.writeId = input.writeToken
      auth.handle.parentWriteId = input.parent?.handle.writeId ?? null
      const handle = { ...auth.handle, declarationVersion: 1n }
      writes.set(handle.writeId, {
        handle,
        declaredFileSize: BigInt(input.declaredFileSize),
        totalChunks: input.totalChunks,
        lastReceipt: null
      })
      return { relativePath, absolutePath: input.absolutePath, authorization: auth }
    },
    prepare: async (_tx: unknown, input: any) => {
      if (input.chunkIndex > 0 && input.observedFileSize === null) return { status: 'INCOMPLETE' }
      return {
        status: 'READY',
        value: {
          action: 'WRITE',
          checkpoint: {
            ...writes.get(input.handle.writeId),
            status: 'ACTIVE',
            nextChunkIndex: input.chunkIndex,
            committedBytes: input.offset
          }
        }
      }
    },
    ack: async (_tx: unknown, input: any) => {
      const write = writes.get(input.handle.writeId)!
      return {
        status: 'READY',
        value: {
          ...write,
          handle: { ...write.handle, declarationVersion: 2n },
          status: input.receipt.chunkIndex + 1 === write.totalChunks ? 'READY' : 'ACTIVE',
          nextChunkIndex: input.receipt.chunkIndex + 1,
          committedBytes: input.verifiedFileSize,
          lastReceipt: input.receipt
        }
      }
    },
    recovery: async () => ({ status: 'READY', value: {} })
  }
}

export const fixtureDirectory = {
  directoryId: 'fixture-directory',
  logicalRoot: 'source-media:v1' as const,
  rootIdentity: 'fixture-root',
  relativeDirectory: 'fixture',
  generation: 0n
}
