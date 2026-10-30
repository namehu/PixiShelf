import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  const onHotRunFallback = vi.fn()
  const value = {
    execution: { runId: 'run', jobId: 'job' },
    transaction,
    read: transaction,
    roots: { source: { logicalRoot: 'source-media:v1', rootIdentity: 'root' } },
    reader: { inspect },
    signal: new AbortController().signal,
    forceRead: false,
    shouldYield: () => false,
    onHotRunBatch,
    onHotRunFallback
  }
  return { value: value as unknown as DedupPipelineContext, transaction, inspect, onHotRunBatch, onHotRunFallback }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.readArtworkDedupHotInventoryPage.mockImplementation(async (_tx, _run, after) => (after === 0 ? [inventory] : []))
  db.readArtworkDedupHotMembersPage.mockImplementation(async (_tx, _ids, after) => (after === 0 ? [member] : []))
  db.saveArtworkDedupHotRunBatch.mockResolvedValue({ status: 'SAVED' })
})
afterEach(() => vi.restoreAllMocks())

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

describe('hot metadata eligibility and commit diagnostics', () => {
  it('accepts an absent artwork source as revision and epoch zero', async () => {
    const test = context()
    const zero = { ...inventory, artwork: { ...inventory.artwork, contentSource: null,
      contentFingerprint: { ...inventory.artwork.contentFingerprint, sourceRevision: 0n, mediaEpoch: 0n } } }
    db.readArtworkDedupHotInventoryPage.mockImplementation(async (_tx, _run, after) => after === 0 ? [zero] : [])
    db.readArtworkDedupHotMembersPage.mockImplementation(async (_tx, _ids, after) => after === 0 ? [
      { ...member, fingerprint: { ...member.fingerprint, artworkMediaEpoch: 0n } }
    ] : [])
    expect(await statArtworkDedupHotRun(test.value)).toBe('DONE')
    expect(db.saveArtworkDedupHotRunBatch).toHaveBeenCalledWith(expect.anything(), test.value.execution,
      [expect.objectContaining({ inventory: zero, complete: true })])
    expect(test.onHotRunFallback).not.toHaveBeenCalled()
    expect(test.onHotRunBatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ hotBatches: 1, reusedArtworks: 1 }))
  })

  it.each([
    ['source revision', null, { sourceRevision: 1n, mediaEpoch: 0n }, 'ARTWORK_SOURCE_CHANGED'],
    ['media epoch', null, { sourceRevision: 0n, mediaEpoch: 1n }, 'ARTWORK_EPOCH_CHANGED'],
    ['active writer', { revision: 1n, mediaEpoch: 1n, writeToken: 'writer' }, {}, 'ARTWORK_WRITING']
  ] as const)('rejects %s mismatches before inspecting or committing files', async (_label, source, fingerprint, reason) => {
    const test = context()
    const changed = { ...inventory, artwork: { ...inventory.artwork, contentSource: source,
      contentFingerprint: { ...inventory.artwork.contentFingerprint, ...fingerprint } } }
    db.readArtworkDedupHotInventoryPage.mockImplementation(async (_tx, _run, after) => after === 0 ? [changed] : [])
    expect(await statArtworkDedupHotRun(test.value)).toBe('FALLBACK')
    expect(test.inspect).not.toHaveBeenCalled()
    expect(db.saveArtworkDedupHotRunBatch).not.toHaveBeenCalled()
    expect(test.onHotRunFallback).toHaveBeenCalledExactlyOnceWith({ phase: 'ARTWORK', reason, artworkId: 1, metadataBytes: expect.any(Number) })
  })

  it('batches mixed absent-zero and explicit nonzero artwork sources together', async () => {
    const test = context()
    const zero = { ...inventory, artwork: { ...inventory.artwork, contentSource: null,
      contentFingerprint: { ...inventory.artwork.contentFingerprint, sourceRevision: 0n, mediaEpoch: 0n } } }
    const explicit = { ...inventory, item: { artworkId: 2, afterImageId: 0 } }
    const rows = [{ ...member, fingerprint: { ...member.fingerprint, artworkMediaEpoch: 0n } },
      { ...member, imageId: 2, artworkId: 2 }]
    db.readArtworkDedupHotInventoryPage.mockImplementation(async (_tx, _run, after) => after === 0 ? [zero, explicit] : [])
    db.readArtworkDedupHotMembersPage.mockImplementation(async (_tx, _ids, after) => after === 0 ? rows : [])
    expect(await statArtworkDedupHotRun(test.value)).toBe('DONE')
    expect(db.saveArtworkDedupHotRunBatch).toHaveBeenCalledOnce()
    expect(db.saveArtworkDedupHotRunBatch.mock.calls[0]![2]).toHaveLength(2)
    expect(test.onHotRunBatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reusedArtworks: 2 }))
  })

  it('reports a fenced commit rejection without counting a saved hot batch', async () => {
    const test = context()
    db.saveArtworkDedupHotRunBatch.mockResolvedValue({ status: 'FALLBACK', reason: 'ARTWORK_CHANGED', artworkId: 1 })
    expect(await statArtworkDedupHotRun(test.value)).toBe('FALLBACK')
    expect(test.onHotRunBatch).not.toHaveBeenCalled()
    expect(test.onHotRunFallback).toHaveBeenCalledExactlyOnceWith({
      phase: 'COMMIT', reason: 'ARTWORK_CHANGED', artworkId: 1, metadataBytes: expect.any(Number), statMs: expect.any(Number)
    })
  })

  it.each(['count', 'latency', 'yield'] as const)('keeps a 502-member artwork snapshot correct across %s boundaries', async boundary => {
    const test = context()
    let elapsed = 0, shouldYield = false
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
    const large = { ...inventory, artwork: { ...inventory.artwork,
      contentFingerprint: { ...inventory.artwork.contentFingerprint, fileCount: 502n } } }
    const rows = Array.from({ length: 502 }, (_, index) => ({ ...member, imageId: index + 1 }))
    db.readArtworkDedupHotInventoryPage.mockImplementation(async (_tx, _run, after) => after === 0 ? [large] : [])
    db.readArtworkDedupHotMembersPage.mockImplementation(async (_tx, _ids, after) => rows.filter(row => row.imageId > after).slice(0, 500))
    test.inspect.mockImplementation(async () => {
      if (test.inspect.mock.calls.length === 4) {
        if (boundary === 'latency') elapsed = 1100
        if (boundary === 'yield') shouldYield = true
      }
      return { canonicalPath: 'work/1.png', state }
    })
    test.value.shouldYield = () => shouldYield
    expect(await statArtworkDedupHotRun(test.value)).toBe(boundary === 'yield' ? 'YIELD' : 'DONE')
    const firstCount = boundary === 'count' ? 500 : 4
    expect(db.saveArtworkDedupHotRunBatch.mock.calls[0]![2]).toEqual([
      expect.objectContaining({ entries: expect.any(Array), complete: false, inventory: large })
    ])
    expect(db.saveArtworkDedupHotRunBatch.mock.calls[0]![2][0].entries).toHaveLength(firstCount)
    if (boundary === 'yield') {
      shouldYield = false
      const resumed = { ...large, item: { ...large.item, status: 'STATTING', afterImageId: firstCount,
        snapshotRevision: 1n, mediaEpoch: 1n, memberCount: 502n } }
      db.readArtworkDedupHotInventoryPage.mockImplementation(async (_tx, _run, after) => after === 0 ? [resumed] : [])
      expect(await statArtworkDedupHotRun(test.value)).toBe('DONE')
    }
    const final = db.saveArtworkDedupHotRunBatch.mock.calls.at(-1)![2][0]
    expect(final).toMatchObject({ complete: true, inventory: { item: { status: 'STATTING', afterImageId: firstCount,
      snapshotRevision: 1n, mediaEpoch: 1n, memberCount: 502n } } })
    expect(final.entries).toHaveLength(502 - firstCount)
    expect(db.saveArtworkDedupHotRunBatch).toHaveBeenCalledTimes(2)
  })
})
