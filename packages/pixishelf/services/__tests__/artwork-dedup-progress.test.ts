// @vitest-environment node
import type { Prisma } from '@pixishelf/db'
import type { ArtworkDedupProgressData } from '@pixishelf/job-contracts'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { getArtworkDedupRun } from '../artwork-dedup-service'

const progress: ArtworkDedupProgressData = {
  kind: 'artwork-dedup', version: 1, phase: 'VISUAL', completed: 2_702, total: 5_624,
  unit: 'images', waitReason: null, uncheckedMedia: 7, updatedAt: '2026-10-29T00:00:00.000Z'
}

function fixture(progressData: ArtworkDedupProgressData | null = progress) {
  const run = {
    id: 'run-progress', artistId: 7, jobId: 'job-progress', version: 2, executionVersion: 1,
    status: 'RUNNING', stage: 'VISUAL', mode: 'INCREMENTAL', visualStatus: 'PENDING',
    visualIncompleteReasons: [], visualBudgetWaiting: false, includeSuspectedVersions: true,
    frozenAt: new Date('2026-10-29T00:00:00.000Z'), startedAt: null, finishedAt: null,
    artworkCount: 10, processedArtworks: 10, completeArtworks: 10, changedArtworks: 0,
    failedArtworks: 0, skippedArtworks: 0, groupCount: 0, duplicateArtworks: 0,
    statMedia: 5_624, hashedMedia: 5_624, cacheHitMedia: 0, readBytes: 0n,
    readerToken: null, readerState: 'IDLE', errorCode: null, performanceSummary: null
  }
  const tx = {
    artist: { findUnique: vi.fn().mockResolvedValue({ name: '青山' }) },
    artworkDedupRun: {
      findUnique: vi.fn().mockResolvedValue(run),
      findFirst: vi.fn().mockResolvedValue(null)
    },
    systemJob: { findUnique: vi.fn().mockResolvedValue({ definitionVersion: 8, progressData }) },
    artworkDedupMedia: { count: vi.fn().mockRejectedValue(new Error('polling must not count media')) }
  }
  const database = {
    $transaction: vi.fn(async (body: (transaction: Prisma.TransactionClient) => Promise<unknown>) => body(tx as never))
  }
  return { database, tx }
}

describe('dedup run durable progress DTO', () => {
  it('uses the same committed job snapshot and unchecked aggregate without a per-poll media count', async () => {
    const { database, tx } = fixture()
    const run = await getArtworkDedupRun('actor', { runId: 'run-progress', expectedUserId: 'actor' }, database as never)
    expect(run).toMatchObject({ progressData: progress, counts: { processedArtworks: 10, visualUncheckedMedia: 7 } })
    expect(tx.systemJob.findUnique).toHaveBeenCalledWith({ where: { id: 'job-progress' }, select: { definitionVersion: true, progressData: true } })
    expect(tx.artworkDedupMedia.count).not.toHaveBeenCalled()
  })

  it('keeps legacy progress unknown without deriving it from artwork counters', async () => {
    const { database, tx } = fixture(null)
    const run = await getArtworkDedupRun('actor', { runId: 'run-progress', expectedUserId: 'actor' }, database as never)
    expect(run).toMatchObject({ stage: 'VISUAL', progressData: null, counts: { visualUncheckedMedia: null } })
    expect(tx.artworkDedupMedia.count).not.toHaveBeenCalled()
  })

  it('preserves the committed scheduler snapshot when queue status advances before the domain run status', async () => {
    const scheduled = { ...progress, waitReason: 'SCHEDULER' as const }
    const { database, tx } = fixture(scheduled)
    tx.systemJob.findUnique.mockResolvedValue({ definitionVersion: 8, status: 'RETRY_WAIT', progressData: scheduled })
    const run = await getArtworkDedupRun('actor', { runId: 'run-progress', expectedUserId: 'actor' }, database as never)
    expect(run).toMatchObject({ status: 'RUNNING', stage: 'VISUAL', progressData: scheduled, allowedControls: ['pause', 'cancel'] })
    expect(tx.artworkDedupMedia.count).not.toHaveBeenCalled()
  })

  it('preserves account consistency before querying progress', async () => {
    const { database } = fixture()
    await expect(getArtworkDedupRun('actor', { runId: 'run-progress', expectedUserId: 'other' }, database as never)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(database.$transaction).not.toHaveBeenCalled()
  })
})
