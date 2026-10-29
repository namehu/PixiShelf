import type { Prisma } from '@pixishelf/db'
import type { ArtworkDedupPerformanceSummary, ArtworkDedupProgressData } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext } from '@pixishelf/job-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createArtworkDedupPerformance } from '../telemetry.ts'
import type { DedupPipelineContext } from '../pipeline.ts'

const mocks = vi.hoisted(() => ({ assertRun: vi.fn(), scan: vi.fn(), groups: vi.fn(), releaseReader: vi.fn(), workerCreated: vi.fn() }))
vi.mock('@pixishelf/db', async original => ({
  ...await original<typeof import('@pixishelf/db')>(),
  assertArtworkDedupExecution: mocks.assertRun,
  refreshArtworkDedupCounts: mocks.assertRun,
  assertArtworkDedupCacheDirectories: vi.fn(async () => true),
  buildArtworkDedupGroups: mocks.groups,
  claimArtworkDedupReader: vi.fn(),
  recordArtworkDedupReaderOwner: vi.fn(),
  releaseArtworkDedupReader: mocks.releaseReader,
  updateArtworkDedupRun: vi.fn(async (tx, input) => tx.artworkDedupRun.update({ where: { id: input.execution.runId }, data: input.data }))
}))
vi.mock('../visual-search.ts', () => ({ scanVisualSearch: mocks.scan }))
vi.mock('../reader-latch.ts', () => ({ releaseExitedDedupReader: vi.fn() }))
vi.mock('../visual-search-worker.ts', () => ({ VisualSearchWorker: class {
  close = vi.fn()
  constructor() { mocks.workerCreated() }
} }))
vi.mock('../root-bindings.ts', () => ({ rootBindings: () => [], sameRootBindings: () => true }))
vi.mock('../../media-content/roots.ts', async original => ({
  ...await original<typeof import('../../media-content/roots.ts')>(),
  resolveMediaContentRoots: async () => ({})
}))
import { createArtworkDedupExecutor, executeArtworkDedup } from '../executor.ts'

type Run = Prisma.ArtworkDedupRunGetPayload<Record<string, never>>

function fixture(options: { rollbackFeature?: number; rejectFinalizer?: boolean; status?: string; releaseFailure?: boolean } = {}) {
  let clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  let run = {
    id: 'run', jobId: 'job', stage: 'VISUAL', status: 'RUNNING', mode: 'INCREMENTAL',
    readBytes: 0n, statMedia: 0, hashedMedia: 0, cacheHitMedia: 0, rootBindings: [],
    visualCheckpoint: options.releaseFailure ? null : { version: 3 }, visualSearchVersion: 'visual-search-v2', visualInputDigest: null,
    visualBudgetWaiting: false, includeSuspectedVersions: true,
    changedArtworks: 0, failedArtworks: 0, skippedArtworks: 0, completeArtworks: 2,
    artworkCount: 2, groupCount: 0, processedArtworks: 2, visualStatus: 'COMPLETE',
    performanceSummary: { ...createArtworkDedupPerformance({ runId: 'run', jobId: 'job', protocolVersion: 8, searchVersion: 'visual-search-v2', inputDigest: null, phase: 'INDEX', updatedAt: new Date(0).toISOString() }), durationsMs: { ...createArtworkDedupPerformance({ runId: 'run', jobId: 'job', protocolVersion: 8, searchVersion: null, inputDigest: null, phase: 'INDEX', updatedAt: new Date(0).toISOString() }).durationsMs, active: 5_000 } }
  } as unknown as Run
  let progressData: ArtworkDedupProgressData | null = null
  let featureCommits = 0
  let mutationCount = 0
  const tx = {
    $transaction: async (body: (transaction: unknown) => Promise<unknown>) => body(tx),
    systemJobEvent: { create: vi.fn(async () => ({})) },
    pixivMetadataInventoryState: { findUnique: vi.fn(async () => null) },
    artworkDedupRun: {
      findUniqueOrThrow: vi.fn(async () => structuredClone(run)),
      update: vi.fn(async ({ data }) => { Object.assign(run, data); return structuredClone(run) })
    },
    systemJob: { update: vi.fn(async ({ data }) => { if (data.progressData) progressData = data.progressData; return {} }) },
    artworkDedupVisualPair: { deleteMany: vi.fn(async () => ({})) },
    artworkDedupRelation: { deleteMany: vi.fn(async () => ({})) },
    artworkDedupGroup: { deleteMany: vi.fn(async () => ({})) }
  }
  mocks.assertRun.mockImplementation(async transaction => transaction.artworkDedupRun.findUniqueOrThrow({ where: { id: 'run' } }))
  mocks.groups.mockImplementation(async transaction => {
    await transaction.artworkDedupRun.update({ where: { id: 'run' }, data: {} })
    return transaction.artworkDedupRun.findUniqueOrThrow({ where: { id: 'run' } })
  })
  if (options.releaseFailure) mocks.releaseReader.mockRejectedValueOnce(new Error('fixture late release failure'))
  const scope = { transaction: tx, executionStatus: options.status ?? 'RUNNING', complete: vi.fn(), fail: vi.fn(), pause: vi.fn(), cancel: vi.fn(), retry: vi.fn(), release: vi.fn() }
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const context = {
    job: { id: 'job', definitionVersion: 8, availableAt: new Date(0) }, payload: { runId: 'run', executionVersion: 1 },
    signal: new AbortController().signal, progress: vi.fn(), logger,
    mutateInTransaction: async (body: (transaction: typeof tx) => Promise<unknown>) => {
      mutationCount++
      const before = structuredClone(run), beforeProgress = progressData
      clock += 1_000
      try {
        const result = await body(tx)
        const current = run.performanceSummary as unknown as ArtworkDedupPerformanceSummary
        if (current.phase === 'FEATURES' && current.counters.decodedImages !== (before.performanceSummary as unknown as ArtworkDedupPerformanceSummary).counters.decodedImages) {
          featureCommits++
          if (featureCommits === options.rollbackFeature) throw new Error('fixture rollback')
        }
        return result
      } catch (error) { run = before; progressData = beforeProgress; throw error }
    },
    finalizeInTransaction: async (body: (value: typeof scope) => Promise<void>) => {
      if (options.rejectFinalizer) throw new Error('execution lease lost')
      await body(scope)
      return { kind: 'transactionally-finalized' }
    }
  } as unknown as ExecutionContext<{ runId: string; executionVersion: number }, EnqueuedChildJob>
  const reader = { metrics: { inspections: 0, reads: 0, bytesRead: 0n, statLatencyMs: 0, parentPeakRss: 0, childPeakRss: 0, ipcMessages: 0 }, start: async () => ({}), resolveRoots: async () => ({}), close: vi.fn() }
  const dependencies = { database: tx as never, sourceRoot: '/fixture', archiveRoot: '/fixture', readerOptions: { entrypoint: '/fixture/reader.cjs' }, supervisor: { create: () => reader } as never, now: () => clock, sliceMs: 60_000, searchCache: { runId: 'run', built: true, worker: { close: vi.fn() } as never } }
  return { context, dependencies, scope, logger, tx, events: tx.systemJobEvent.create, getRun: () => run, getProgress: () => progressData, elapsed: () => clock, mutations: () => mutationCount }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('committed artwork detection lifecycle telemetry', () => {
  it('adds active elapsed time once across feature checkpoints and preserves query counters', async () => {
    const f = fixture()
    mocks.scan.mockImplementation(async (pipeline: DedupPipelineContext) => {
      for (let completed = 1; completed <= 3; completed++) await pipeline.transaction(async tx => {
        await pipeline.onFeatureBatch!(tx, { completed, total: 3, uncheckedMedia: 0, decodedImages: 1, ownFeatureHits: 0, contentFeatureHits: 0, readBytes: 0, featureMs: 1 })
      })
      await pipeline.transaction(async tx => {
        const run = await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: 'run' } })
        const summary = run.performanceSummary as unknown as ArtworkDedupPerformanceSummary
        await tx.artworkDedupRun.update({ where: { id: 'run' }, data: { stage: 'DONE', performanceSummary: { ...summary, phase: 'PUBLISH', counters: { ...summary.counters, compareCalls: 50 } } as never } })
      })
      return true
    })
    await executeArtworkDedup(f.context, f.dependencies)
    const summary = f.getRun().performanceSummary as unknown as ArtworkDedupPerformanceSummary
    expect(summary.durationsMs.active).toBe(5_000 + f.elapsed())
    expect(summary.durationsMs).toMatchObject({ queue: 0, cooldown: 0, pause: null })
    expect(summary.counters).toMatchObject({ decodedImages: 3, compareCalls: 50 })
    expect(summary.counters.transactions).toBeGreaterThan(0)
    expect(summary.counters.transactions).toBe(f.mutations() + 1)
    expect(summary.counters.dbValidationCalls).toBe(f.tx.artworkDedupRun.findUniqueOrThrow.mock.calls.length + f.tx.pixivMetadataInventoryState.findUnique.mock.calls.length)
    expect(summary.counters.dbWriteCalls).toBe(f.tx.artworkDedupRun.update.mock.calls.length + f.tx.systemJob.update.mock.calls.length + f.events.mock.calls.length - 3)
    expect(summary).toMatchObject({ phase: 'COMPLETED', complete: true })
    expect(f.getProgress()).toMatchObject({ phase: 'COMPLETED', waitReason: null })
    expect(f.scope.complete).toHaveBeenCalledOnce()
    expect(f.events).toHaveBeenCalledTimes(3)
    expect(f.logger.info.mock.calls.at(-1)?.[1]).toMatchObject({ reason: 'COMPLETED' })
  })

  it('does not advance feature counters or the active watermark for a rolled-back checkpoint', async () => {
    const f = fixture({ rollbackFeature: 2 })
    mocks.scan.mockImplementation(async (pipeline: DedupPipelineContext) => {
      for (let completed = 1; completed <= 3; completed++) await pipeline.transaction(async tx => {
        await pipeline.onFeatureBatch!(tx, { completed, total: 3, uncheckedMedia: 0, decodedImages: 1, ownFeatureHits: 0, contentFeatureHits: 0, readBytes: 0, featureMs: 1 })
      })
      return true
    })
    await executeArtworkDedup(f.context, f.dependencies)
    const summary = f.getRun().performanceSummary as unknown as ArtworkDedupPerformanceSummary
    expect(summary.durationsMs.active).toBe(5_000 + f.elapsed())
    expect(summary.counters.decodedImages).toBe(1)
    expect(summary.complete).toBe(false)
    expect(f.scope.fail).toHaveBeenCalledOnce()
    expect(f.logger.info.mock.calls.at(-1)?.[1]).toMatchObject({ reason: 'FAILED' })
  })

  it('does not publish a completed snapshot or log when finalization loses authority', async () => {
    const f = fixture({ rejectFinalizer: true })
    mocks.scan.mockResolvedValue(true)
    await expect(executeArtworkDedup(f.context, f.dependencies)).rejects.toThrow('execution lease lost')
    expect(f.getProgress()?.phase).not.toBe('COMPLETED')
    expect(f.logger.info.mock.calls.some(call => (call[1] as { reason: string }).reason === 'COMPLETED')).toBe(false)
    expect(f.scope.complete).not.toHaveBeenCalled()
  })

  it.each(['PAUSING', 'CANCELLING'])('persists %s without a completion and releases the search index', async status => {
    const f = fixture({ status })
    mocks.scan.mockResolvedValue(false)
    await executeArtworkDedup(f.context, f.dependencies)
    expect(f.getProgress()).toMatchObject({ waitReason: status === 'PAUSING' ? 'USER_PAUSED' : null })
    expect(f.getProgress()?.phase).not.toBe('COMPLETED')
    expect(f.dependencies.searchCache.worker).toBeUndefined()
    expect(f.scope.complete).not.toHaveBeenCalled()
    expect(f.logger.info.mock.calls.at(-1)?.[1]).toMatchObject({ reason: status === 'PAUSING' ? 'PAUSED' : 'CANCELLED' })
  })

  it('keeps an automatic compute yield distinct from a user pause and preserves zero cooldown', async () => {
    const f = fixture()
    mocks.scan.mockResolvedValue(false)
    await executeArtworkDedup(f.context, f.dependencies)
    expect(f.getProgress()).toMatchObject({ waitReason: 'SCHEDULER' })
    expect(f.scope.pause).not.toHaveBeenCalled()
    expect(f.scope.retry).toHaveBeenCalledWith(expect.objectContaining({ availableAt: new Date(f.elapsed()), schedulingYield: true }))
    expect((f.getRun().performanceSummary as unknown as ArtworkDedupPerformanceSummary).durationsMs.cooldown).toBe(0)
    expect((f.getRun().performanceSummary as unknown as ArtworkDedupPerformanceSummary).counters.transactions).toBe(f.mutations() + 1)
  })

  it('discards a built index after late reader release failure before a new executor retries the same run', async () => {
    const f = fixture({ releaseFailure: true })
    const staleWorker = f.dependencies.searchCache.worker as unknown as { close: ReturnType<typeof vi.fn> }
    mocks.scan.mockResolvedValue(false)
    await executeArtworkDedup(f.context, f.dependencies)
    expect(f.scope.fail).toHaveBeenCalledOnce()
    expect(staleWorker.close).toHaveBeenCalledOnce()
    expect(f.dependencies.searchCache).toMatchObject({ built: false, worker: undefined })
    mocks.scan.mockImplementationOnce(async (pipeline: DedupPipelineContext) => {
      expect(pipeline.searchCache?.built).toBe(false)
      expect(pipeline.searchWorker).not.toBe(staleWorker)
      return false
    })
    const replacement = createArtworkDedupExecutor(f.dependencies, 8)
    await replacement.execute(f.context)
    expect(mocks.workerCreated).toHaveBeenCalledOnce()
  })
})
