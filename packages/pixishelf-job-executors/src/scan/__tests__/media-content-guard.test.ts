import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@pixishelf/db'
import type { ExecutionContext } from '@pixishelf/job-runtime'
import { captureScanMediaDirectory, assertScanMediaDirectory } from '../media-content-guard.ts'

const mocks = vi.hoisted(() => ({ capture: vi.fn(), assert: vi.fn(), roots: vi.fn() }))
vi.mock('@pixishelf/db', () => ({
  captureMediaContentDirectory: mocks.capture,
  assertMediaContentDirectorySnapshot: mocks.assert
}))
vi.mock('../../media-content/index.ts', () => ({ resolveMediaContentRoots: mocks.roots }))
const snapshot = {
  directoryId: 'directory',
  generation: 4n,
  relativeDirectory: 'artist',
  logicalRoot: 'source-media:v1' as const,
  rootIdentity: 'root'
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.roots.mockResolvedValue({ source: { logicalRoot: 'source-media:v1', rootIdentity: 'root' } })
  mocks.capture.mockResolvedValue({ status: 'READY', value: snapshot })
  mocks.assert.mockResolvedValue({ status: 'READY', value: snapshot })
})

describe('scan content publication boundary', () => {
  it('resolves the same inventory root and captures generation before discovery', async () => {
    const tx = {
      pixivMetadataInventoryState: { findUnique: vi.fn().mockResolvedValue({ rootIdentity: 'marker' }) }
    } as unknown as Prisma.TransactionClient
    const context = {
      mutateInTransaction: vi.fn(async (action: (tx: Prisma.TransactionClient) => unknown) => action(tx))
    } as unknown as ExecutionContext
    const result = await captureScanMediaDirectory({ context, scanRoot: '/fixture', relativeDirectory: 'artist' })
    expect(result).toEqual(snapshot)
    expect(mocks.roots).toHaveBeenCalledWith({
      sourceRoot: '/fixture',
      archiveRoot: '/fixture',
      expectedPixivRootIdentity: 'marker'
    })
    expect(mocks.capture).toHaveBeenCalledWith(tx, {
      directory: { logicalRoot: 'source-media:v1', rootIdentity: 'root', relativeDirectory: 'artist' }
    })
  })

  it.each(['WRITING', 'STALE', 'ROOT_CHANGED'])('rejects %s without allowing reconciliation', async (status) => {
    mocks.assert.mockResolvedValue({ status })
    const mutateMembers = vi.fn()
    await expect(
      (async () => {
        await assertScanMediaDirectory({} as Prisma.TransactionClient, snapshot)
        await mutateMembers()
      })()
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(mutateMembers).not.toHaveBeenCalled()
  })

  it('propagates database failure instead of interpreting it as an empty directory', async () => {
    mocks.assert.mockRejectedValue(new Error('database unavailable'))
    await expect(assertScanMediaDirectory({} as Prisma.TransactionClient, snapshot)).rejects.toThrow(
      'database unavailable'
    )
  })
})
