import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@pixishelf/db'
import type { ExecutionContext } from '@pixishelf/job-runtime'
import {
  beginExecutorMediaWrite,
  beginExecutorMediaDirectoryWrites,
  publishExecutorMediaWrite,
  assertExecutorMediaWrite
} from '../media-content-write.ts'

const mocks = vi.hoisted(() => ({
  consumeRecovery: vi.fn(),
  beginPath: vi.fn(),
  beginSource: vi.fn(),
  resumeSource: vi.fn(),
  finishSource: vi.fn(),
  ownerPublication: vi.fn(),
  ownerAssert: vi.fn()
}))
vi.mock('@pixishelf/db', () => ({
  consumeMediaContentRecovery: mocks.consumeRecovery,
  beginMediaContentPathWrite: mocks.beginPath,
  beginMediaContentSourceWrite: mocks.beginSource,
  resumeMediaContentSourceWrite: mocks.resumeSource,
  finishMediaContentSourceWrite: mocks.finishSource,
  withMediaContentOwnerPublication: mocks.ownerPublication,
  assertMediaContentOwnerPublication: mocks.ownerAssert
}))
vi.mock('../../media-content/index.ts', () => ({ resolveMediaContentRoots: vi.fn() }))
const transaction = {} as Prisma.TransactionClient
const context = {
  job: { id: 'job', executionToken: '00000000-0000-4000-8000-000000000001', attempt: 2 },
  mutateInTransaction: async (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
    operation(transaction)
} as unknown as ExecutionContext
const directory = { logicalRoot: 'source-media:v1' as const, rootIdentity: 'root', relativeDirectory: 'artist' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.consumeRecovery.mockResolvedValue({ status: 'MISSING' })
  mocks.beginPath.mockImplementation(async (_tx, input) => ({
    status: 'READY',
    value: {
      writeId: input.writeToken,
      directoryId: input.directory.relativeDirectory,
      writeToken: input.writeToken,
      declarationVersion: 0n,
      scope: input.scope,
      parentWriteId: null
    }
  }))
  mocks.beginSource.mockImplementation(async (_tx, input) => ({
    writeToken: input.writeToken,
    artworkIds: input.artworkIds,
    imageIds: input.imageIds
  }))
  mocks.resumeSource.mockResolvedValue({ status: 'MISSING' })
  mocks.finishSource.mockResolvedValue(true)
  mocks.ownerPublication.mockImplementation(async (tx, _input, publish) => ({
    result: await publish(tx),
    finishedWriteIds: []
  }))
})

describe('Worker content ownership adapter', () => {
  it('uses a granted original claim without starting another source epoch', async () => {
    const granted = {
      owner: {},
      handles: [{ writeToken: 'original' }],
      source: { writeToken: 'original', artworkIds: [1], imageIds: [] }
    }
    mocks.consumeRecovery.mockResolvedValue({ status: 'READY', value: granted })
    await expect(
      beginExecutorMediaWrite({
        context,
        directory,
        scope: { kind: 'DIRECTORY' },
        sessionId: 'migration:1',
        artworkIds: [1]
      })
    ).resolves.toEqual(granted)
    expect(mocks.beginPath).not.toHaveBeenCalled()
    expect(mocks.beginSource).not.toHaveBeenCalled()
  })

  it('never falls back to an ordinary begin after finding an invalid grant', async () => {
    mocks.consumeRecovery.mockResolvedValue({ status: 'STALE' })
    await expect(
      beginExecutorMediaWrite({
        context,
        directory,
        scope: { kind: 'DIRECTORY' },
        sessionId: 'migration:1',
        artworkIds: [1]
      })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(mocks.beginPath).not.toHaveBeenCalled()
  })

  it('persists the path declaration before invalidating media and carries the actual execution token', async () => {
    const write = await beginExecutorMediaWrite({
      context,
      directory,
      scope: { kind: 'PATH', relativePath: 'artist/1.jpg' },
      sessionId: 'replace:1',
      imageIds: [1]
    })
    expect(mocks.beginPath.mock.invocationCallOrder[0]).toBeLessThan(mocks.beginSource.mock.invocationCallOrder[0]!)
    expect(write.owner.execution).toEqual({
      jobId: 'job',
      executionToken: context.job.executionToken,
      executionAttempt: 2
    })
    expect(write.source.imageIds).toEqual([1])
  })

  it('does not start source writes when another owner already protects the path', async () => {
    mocks.beginPath.mockResolvedValue({ status: 'WRITING' })
    await expect(
      beginExecutorMediaWrite({
        context,
        directory,
        scope: { kind: 'DIRECTORY' },
        sessionId: 'replace:1',
        artworkIds: [1]
      })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(mocks.beginSource).not.toHaveBeenCalled()
  })

  it('uses distinct claim tokens and stable directory order for a migration', async () => {
    const write = await beginExecutorMediaDirectoryWrites({
      context,
      directories: [
        { ...directory, relativeDirectory: 'z' },
        { ...directory, relativeDirectory: 'a' }
      ],
      sessionId: 'migration:1',
      artworkIds: [1]
    })
    expect(write.handles.map((handle) => handle.directoryId)).toEqual(['a', 'z'])
    expect(new Set(write.handles.map((handle) => handle.writeToken)).size).toBe(2)
    expect(mocks.beginSource).toHaveBeenCalledOnce()
  })

  it('keeps intermediate publication separate from the final gate release', async () => {
    const write = await beginExecutorMediaWrite({
      context,
      directory,
      scope: { kind: 'DIRECTORY' },
      sessionId: 'migration:1',
      artworkIds: [1]
    })
    await assertExecutorMediaWrite(transaction, write)
    expect(mocks.ownerAssert).toHaveBeenCalledWith(transaction, { owner: write.owner, handles: write.handles })
    expect(mocks.finishSource).not.toHaveBeenCalled()
  })

  it('rejects a stale source token after business DML so the enclosing transaction rolls back', async () => {
    const write = await beginExecutorMediaWrite({
      context,
      directory,
      scope: { kind: 'DIRECTORY' },
      sessionId: 'replace:1',
      artworkIds: [1]
    })
    mocks.finishSource.mockResolvedValue(false)
    const publish = vi.fn(async () => 17)
    await expect(publishExecutorMediaWrite(transaction, write, 'committed', publish)).rejects.toMatchObject({
      code: 'STATE_CONFLICT'
    })
    expect(publish).toHaveBeenCalledOnce()
  })
})
