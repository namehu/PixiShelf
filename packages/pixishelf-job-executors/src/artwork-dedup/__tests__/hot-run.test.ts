import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DedupPipelineContext } from '../pipeline.ts'
import {
  HOT_RUN_MEMORY_BUDGET,
  HOT_RUN_PRELOAD_LIMIT,
  hotRunMetadataBytes,
  statArtworkDedupHotRun
} from '../hot-run.ts'

const db = vi.hoisted(() => ({
  ARTWORK_DEDUP_VISUAL_EVIDENCE_VERSION: 'dct63-grid3-crop-local1-mixed-v2',
  readArtworkDedupHotInventoryPage: vi.fn(),
  readArtworkDedupHotMembersPage: vi.fn(),
  saveArtworkDedupHotRunBatch: vi.fn(),
  beginArtworkDedupHotRunReuse: vi.fn(),
  copyArtworkDedupHotRunReusePage: vi.fn()
}))
vi.mock('@pixishelf/db', () => db)

const inventory = Object.freeze({
  item: Object.freeze({ artworkId: 1, afterImageId: 0 }),
  artwork: Object.freeze({
    source: 'LOCAL_CREATED',
    contentSource: Object.freeze({ revision: 1n, mediaEpoch: 1n, writeToken: null }),
    contentFingerprint: Object.freeze({ algorithmVersion: 1, sourceRevision: 1n, mediaEpoch: 1n, fileCount: 1n })
  })
})
const state = Object.freeze({ size: 100n, mtimeNs: 1n, ctimeNs: 2n, deviceId: 3n, inode: 4n })
const member = Object.freeze({
  imageId: 1,
  artworkId: 1,
  sourcePath: 'work/1.png',
  sourceRevision: 1n,
  writeToken: null,
  directory: Object.freeze({
    logicalRoot: 'source-media:v1',
    rootIdentity: 'root',
    relativeDirectory: 'work',
    directoryId: 'directory',
    generation: 1n
  }),
  fingerprint: Object.freeze({
    ...state,
    algorithmVersion: 1,
    sourceRevision: 1n,
    artworkMediaEpoch: 1n,
    sourcePath: 'work/1.png',
    rootIdentity: 'root',
    canonicalPath: 'work/1.png',
    sha256: 'a'.repeat(64)
  })
})

function context() {
  const transaction = vi.fn(async (operation: (tx: never) => Promise<unknown>) => operation({} as never))
  const inspect = vi.fn(async () => ({ canonicalPath: 'work/1.png', state }))
  const onHotRunBatch = vi.fn(async () => {})
  const value = {
    execution: { runId: 'run', jobId: 'job' },
    transaction,
    read: transaction,
    roots: { source: { logicalRoot: 'source-media:v1', rootIdentity: 'root' } },
    reader: { inspect },
    signal: new AbortController().signal,
    forceRead: false,
    shouldYield: () => false,
    onHotRunBatch
  }
  return { value: value as unknown as DedupPipelineContext, transaction, inspect, onHotRunBatch }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.readArtworkDedupHotInventoryPage.mockImplementation(async (_tx, _run, after) => (after === 0 ? [inventory] : []))
  db.readArtworkDedupHotMembersPage.mockImplementation(async (_tx, _ids, after) => (after === 0 ? [member] : []))
  db.saveArtworkDedupHotRunBatch.mockResolvedValue(true)
})

describe('task-scoped hot metadata budget and lifetime', () => {
  it('leaves headroom between the preload cutoff and extra-workset budget', () => {
    expect(HOT_RUN_PRELOAD_LIMIT).toBe(800 * 1024 * 1024)
    expect(HOT_RUN_MEMORY_BUDGET).toBe(1024 * 1024 * 1024)
    expect(hotRunMetadataBytes([{ revision: 1n }])).toBeGreaterThan(Buffer.byteLength('[{"revision":"1"}]'))
  })

  it('records inventory-budget fallback before reading members or inspecting files', async () => {
    const test = context()
    expect(await statArtworkDedupHotRun(test.value, 1)).toBe('FALLBACK')
    expect(db.readArtworkDedupHotMembersPage).not.toHaveBeenCalled()
    expect(test.inspect).not.toHaveBeenCalled()
    expect(db.saveArtworkDedupHotRunBatch).not.toHaveBeenCalled()
    expect(test.onHotRunBatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadataBytes: hotRunMetadataBytes([inventory]), hotBatches: 0, reusedArtworks: 0 })
    )
  })

  it('falls back during member preload without committing the partial metadata set', async () => {
    const test = context()
    const limit = hotRunMetadataBytes([inventory]) + hotRunMetadataBytes([member])
    expect(await statArtworkDedupHotRun(test.value, limit)).toBe('FALLBACK')
    expect(test.inspect).not.toHaveBeenCalled()
    expect(db.saveArtworkDedupHotRunBatch).not.toHaveBeenCalled()
    expect(test.onHotRunBatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadataBytes: limit, hotBatches: 0 })
    )
  })

  it('uses a new task snapshot after yielding and never mutates readonly preload rows', async () => {
    const first = context()
    first.value.shouldYield = () => true
    expect(await statArtworkDedupHotRun(first.value)).toBe('YIELD')
    expect(first.inspect).not.toHaveBeenCalled()
    expect(db.saveArtworkDedupHotRunBatch).not.toHaveBeenCalled()
    const second = context()
    expect(await statArtworkDedupHotRun(second.value)).toBe('DONE')
    expect(second.inspect).toHaveBeenCalledTimes(1)
    expect(db.readArtworkDedupHotInventoryPage.mock.calls.filter((call) => call[2] === 0)).toHaveLength(2)
    expect(db.saveArtworkDedupHotRunBatch).toHaveBeenCalledTimes(1)
    expect(member.sourcePath).toBe('work/1.png')
    expect(inventory.item.afterImageId).toBe(0)
  })

  it('stops an aborted preload before inspection and starts later work from fresh reads', async () => {
    const first = context(),
      controller = new AbortController()
    first.value.signal = controller.signal
    db.readArtworkDedupHotInventoryPage.mockImplementationOnce(async () => {
      controller.abort()
      return [inventory]
    })
    await expect(statArtworkDedupHotRun(first.value)).rejects.toThrow()
    expect(first.inspect).not.toHaveBeenCalled()
    expect(db.saveArtworkDedupHotRunBatch).not.toHaveBeenCalled()
    const second = context()
    expect(await statArtworkDedupHotRun(second.value)).toBe('DONE')
    expect(second.inspect).toHaveBeenCalledTimes(1)
  })
})
