import { createHash } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ExecutionContext,
  ExecutionProgressUpdate,
  EnqueuedChildJob,
  FencedMutationTransactionTiming
} from '@pixishelf/job-runtime'
import type { ScanPayload } from '@pixishelf/job-contracts'
import { executeScan } from '../scan-executor.ts'
import { publishPixivArtwork } from '../pixiv-publisher.ts'
import { readStableFileContent } from '../content-reader.ts'
import { collectArtworkMedia } from '../discovery.ts'
import { recordInventoryFailure } from '../inventory-run.ts'
import { finalizeScanError, finalizeScanSuccess } from '../lifecycle.ts'
import type { MetadataInputRow } from '../run-store.ts'

const fixture = vi.hoisted(() => ({
  rows: [] as unknown[],
  checkpoints: new Map<string, { status: string; newImageCount: number }>()
}))
vi.mock('@pixishelf/db', () => ({ lockCreatorCatalog: vi.fn(async () => undefined), Prisma: {} }))
vi.mock('../dedup-source-snapshot.ts', () => ({
  assertPixivScanSources: vi.fn(async () => undefined),
  isScanSourceProofRejection: () => false
}))
vi.mock('../media-content-guard.ts', () => ({
  captureScanMediaDirectory: vi.fn(async () => ({ rootIdentity: 'root' })),
  assertScanMediaDirectory: vi.fn(async () => undefined)
}))
vi.mock('../root-identity.ts', () => ({ assertPixivRootUnchanged: vi.fn(async () => undefined) }))
vi.mock('../paths.ts', () => ({
  resolveSafeScanRoot: vi.fn(async () => ({ absolutePath: 'synthetic-root' })),
  resolveSafeExistingPath: vi.fn(async (_root, relativePath) => ({ relativePath, absolutePath: relativePath }))
}))
vi.mock('../run-store.ts', () => ({
  startOrResumeScanRun: vi.fn(async () => ({
    id: 'run-1',
    startedAt: new Date(),
    inputFrozenAt: new Date(),
    inventoryBaselineGeneration: null
  })),
  scanMode: () => 'CLIENT_LIST',
  verifyFrozenMetadataSnapshot: vi.fn(async () => ({
    count: fixture.rows.length,
    metadataCandidates: fixture.rows.length,
    inventoryUnchanged: 0
  })),
  iterateFrozenMetadataPages: async function* () {
    yield fixture.rows
  }
}))
vi.mock('../inventory-run.ts', () => ({
  ensurePixivInventoryRootIdentity: vi.fn(async () => undefined),
  freezeIncrementalInventorySnapshot: vi.fn(),
  recordPublishedInventory: vi.fn(async () => undefined),
  recordExistingInventoryDecision: vi.fn(async () => ({ status: 'SKIPPED', newImages: 0 })),
  recordInventoryFailure: vi.fn(async () => ({ status: 'FAILED', newImages: 0 }))
}))
vi.mock('../inventory.ts', () => ({ hashScanRootIdentity: () => 'root-hash' }))
vi.mock('../lifecycle.ts', () => ({
  finalizeScanSuccess: vi.fn(async () => ({ kind: 'transactionally-finalized' })),
  finalizeScanError: vi.fn(async () => ({ kind: 'failed' }))
}))
vi.mock('../local-rescan.ts', () => ({ executeLocalArtworkRescan: vi.fn() }))
vi.mock('../content-reader.ts', () => ({ readStableFileContent: vi.fn() }))
vi.mock('../discovery.ts', () => ({ collectArtworkMedia: vi.fn() }))
vi.mock('../pixiv-publisher.ts', () => ({ publishPixivArtwork: vi.fn() }))

const transactionTiming: FencedMutationTransactionTiming = {
  acquisitionMs: 1,
  preFenceMs: 2,
  bodyMs: 3,
  postFenceMs: 4,
  commitFinalizationMs: 5,
  wallMs: 15,
  fenceReadCalls: 4
}
const key = (ordinal: number) =>
  `metadata:${ordinal}:${createHash('sha256')
    .update(`${ordinal + 1}-meta.json`)
    .digest('hex')}`
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function testContext() {
  const tx = {
    scanRunItem: {
      findUnique: vi.fn(
        async ({ where }) => fixture.checkpoints.get(where.scanRunId_checkpointKey.checkpointKey) ?? null
      )
    }
  }
  const context = {
    job: { id: 'job-1', attempt: 1, maxAttempts: 1 },
    payload: { mode: 'CLIENT_LIST', existingPolicy: 'REFRESH', inputCount: 3, inputDigest: 'a'.repeat(64) },
    signal: new AbortController().signal,
    progress: vi.fn(async (_input: ExecutionProgressUpdate) => undefined),
    mutateInTransaction: vi.fn(async (operation, observer) => {
      const result = await operation(tx)
      observer?.(transactionTiming)
      return result
    }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
  const database = {
    scanRunItem: {
      findUnique: tx.scanRunItem.findUnique,
      findMany: vi.fn(async () => [...fixture.checkpoints.keys()].map((checkpointKey) => ({ checkpointKey }))),
      count: vi.fn(async () => 0)
    },
    pixivMetadataInventory: {
      findUnique: vi.fn(async () => ({
        lastSeenScanRunId: 'run-1',
        lastAttemptedContentHash: 'a'.repeat(64),
        lastErrorCode: 'SOURCE_NOT_READABLE',
        lastErrorRetryable: true
      }))
    }
  }
  return {
    context,
    execute: () =>
      executeScan(context as unknown as ExecutionContext<ScanPayload, EnqueuedChildJob>, {
        database: database as never,
        config: { scanRoot: 'synthetic-root' }
      })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.checkpoints.clear()
  fixture.rows = Array.from({ length: 3 }, (_, ordinal) => ({
    ordinal,
    relativePath: `${ordinal + 1}-meta.json`,
    contentHash: 'a'.repeat(64)
  })) as MetadataInputRow[]
  vi.mocked(readStableFileContent).mockImplementation(async ({ absolutePath }) => ({
    bytes: Buffer.from(
      JSON.stringify({ id: absolutePath.split('-')[0], title: 'Synthetic', user: 'Artist', userId: '1', tags: [] })
    ),
    sha256: 'a'.repeat(64),
    size: 1,
    state: { sizeBytes: 1n, mtimeMs: 1n, ctimeMs: null, deviceId: null, inode: null }
  }))
  vi.mocked(collectArtworkMedia).mockImplementation(
    async (_root, candidate) => [{ relativePath: `${candidate.artworkId}.jpg` }] as never
  )
  vi.mocked(publishPixivArtwork).mockImplementation(async (input) => {
    fixture.checkpoints.set(input.checkpointKey, { status: 'SUCCESS', newImageCount: 1 })
    return { status: 'SUCCESS', newImages: 1, artworkId: Number(input.metadata.id) }
  })
})

describe('ordinary Pixiv durable progress and timing', () => {
  it('reports a committed item before the rest of a sub-100 page finishes, and stays monotonic in completion order', async () => {
    const gate = deferred()
    const f = testContext()
    vi.mocked(publishPixivArtwork).mockImplementation(async (input) => {
      if (input.checkpointOrdinal === 0) await gate.promise
      fixture.checkpoints.set(input.checkpointKey, { status: 'SUCCESS', newImageCount: 1 })
      return { status: 'SUCCESS', newImages: 1, artworkId: 1 }
    })
    const execution = f.execute()
    await vi.waitFor(() =>
      expect(f.context.progress).toHaveBeenCalledWith(expect.objectContaining({ data: { processed: 2, total: 3 } }))
    )
    expect(finalizeScanSuccess).not.toHaveBeenCalled()
    gate.resolve()
    await execution
    expect(
      f.context.progress.mock.calls.map(([input]) => (input as { data: { processed: number } }).data.processed)
    ).toEqual([0, 1, 2, 3, 3])
    expect(f.context.progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ persistenceMode: 'REALTIME', forcePersistence: true })
    )
  })

  it('does not count a durable FAILED retry or a SUCCESS replay twice on resume', async () => {
    fixture.checkpoints.set(key(0), { status: 'SUCCESS', newImageCount: 1 })
    fixture.checkpoints.set(key(1), { status: 'FAILED', newImageCount: 0 })
    const f = testContext()
    await f.execute()
    const counts = f.context.progress.mock.calls.map(
      ([input]) => (input as { data: { processed: number } }).data.processed
    )
    expect(counts[0]).toBe(2)
    expect(counts.every((count) => count >= 2 && count <= 3)).toBe(true)
    expect(counts.at(-1)).toBe(3)
    expect(publishPixivArtwork).toHaveBeenCalledTimes(2)
  })

  it('drains already-started publication after a progress failure before finalizing, without recording a bad input', async () => {
    const gate = deferred()
    const f = testContext()
    const progressError = new Error('progress fence rejected')
    f.context.progress
      .mockImplementationOnce(async () => undefined)
      .mockImplementation(async () => {
        throw progressError
      })
    vi.mocked(publishPixivArtwork).mockImplementation(async (input) => {
      if (input.checkpointOrdinal !== 0) await gate.promise
      return { status: 'SUCCESS', newImages: 1, artworkId: 1 }
    })
    const execution = f.execute()
    await vi.waitFor(() => expect(f.context.progress).toHaveBeenCalledTimes(2))
    await setImmediate()
    expect(finalizeScanError).not.toHaveBeenCalled()
    gate.resolve()
    await execution
    expect(finalizeScanError).toHaveBeenCalledWith(expect.objectContaining({ error: progressError }))
    expect(recordInventoryFailure).not.toHaveBeenCalled()
  })

  it('samples successful item timing after work and logs committed transaction phases without input contents', async () => {
    const f = testContext()
    await f.execute()
    const publisherInput = vi.mocked(publishPixivArtwork).mock.calls[0]![0]
    const sample = publisherInput.checkpointTiming!()
    expect(sample.finishedAt.getTime()).toBeGreaterThanOrEqual(sample.startedAt.getTime())
    expect(sample.durationMs).toBeGreaterThanOrEqual(0)
    expect(f.context.logger.info).toHaveBeenCalledWith(
      'scan.input.completed',
      expect.objectContaining({
        jobId: 'job-1',
        runId: 'run-1',
        ordinal: 0,
        mediaCount: 1,
        metadataReadMs: expect.any(Number),
        mediaEnumerationMs: expect.any(Number),
        transactions: expect.arrayContaining([{ phase: 'publish', ...transactionTiming }])
      })
    )
    const completion = f.context.logger.info.mock.calls.filter(([event]) => event === 'scan.input.completed')
    expect(JSON.stringify(completion)).not.toContain('Synthetic')
    expect(JSON.stringify(completion)).not.toContain('-meta.json')
  })

  it('measures failed metadata and failed media stages and preserves unentered stages as unknown', async () => {
    const f = testContext()
    vi.mocked(readStableFileContent).mockRejectedValueOnce(new Error('metadata unavailable'))
    vi.mocked(collectArtworkMedia).mockRejectedValueOnce(new Error('media unavailable'))
    await f.execute()
    const completions = f.context.logger.info.mock.calls
      .filter(([event]) => event === 'scan.input.completed')
      .map(([, data]) => data)
    expect(completions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'FAILED', metadataReadMs: expect.any(Number), mediaEnumerationMs: null }),
        expect.objectContaining({
          status: 'FAILED',
          metadataReadMs: expect.any(Number),
          mediaEnumerationMs: expect.any(Number)
        })
      ])
    )
    for (const [input] of vi.mocked(recordInventoryFailure).mock.calls)
      expect(input.checkpointTiming!().durationMs).toBeGreaterThanOrEqual(0)
  })
})
