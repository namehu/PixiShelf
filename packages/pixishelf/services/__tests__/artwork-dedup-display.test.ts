// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('../artwork-dedup-cover', () => ({ artworkDedupCoverUrls: vi.fn(async () => new Map()) }))
vi.mock('@pixishelf/job-contracts', async (original) => ({
  ...(await original<typeof import('@pixishelf/job-contracts')>()),
  isArtworkDedupMaintenanceModeEnabled: () => true
}))
import { artworkDedupOperationDto, getArtworkDedupOperation } from '../artwork-dedup-review-service'

const date = new Date('2026-10-24T00:00:00Z')
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op-1',
    artistId: 7,
    runId: 'run-1',
    requestedBy: 'user-a',
    runVersion: 1,
    version: 2,
    executionVersion: 1,
    jobId: null,
    mode: 'DIRECT_DELETE',
    originalAction: 'DIRECT_DELETE',
    preparePurpose: 'DIRECT_DELETE',
    protocolVersion: 1,
    scopeDigest: 'a'.repeat(64),
    status: 'DRAINING',
    stage: 'DRAIN',
    createdAt: date,
    updatedAt: date,
    validatedAt: date,
    deleteStartedAt: null,
    cancelRequestedAt: null,
    selectedGroups: 1,
    excludedGroups: 0,
    blockedGroups: 0,
    keepers: 1,
    copies: 1,
    preparedArtworks: 2,
    preparedFiles: 6n,
    logicalBytes: 1000n,
    movedFiles: 0n,
    restoredFiles: 0n,
    deletedFiles: 0n,
    requiresOrganizationConfirmation: true,
    backupCheckpointRef: null,
    purgePreviewStatus: null,
    errorCode: null,
    readerState: 'IDLE',
    readerToken: null,
    ...overrides
  }
}
beforeEach(() => vi.clearAllMocks())
describe('deduplication display facts', () => {
  it('uses persisted deleteStartedAt to expose cancellation before any intent and stopping afterwards', () => {
    for (const status of ['DRAINING', 'VERIFYING', 'DELETING']) {
      const before = artworkDedupOperationDto(row({ status }) as never)
      expect(before.allowedActions).toEqual(['CANCEL'])
      expect(before.deleteStartedAt).toBeNull()
      const after = artworkDedupOperationDto(row({ status, deleteStartedAt: date }) as never)
      expect(after.allowedActions).toEqual(['STOP'])
      expect(after.deleteStartedAt).toBe(date.toISOString())
    }
    const requested = artworkDedupOperationDto(row({ cancelRequestedAt: date }) as never)
    expect(requested.stopRequested).toBe(true)
    expect(requested.allowedActions).toEqual([])
  })
  it('keeps prepare cancellation available while the reader is active without claiming it has exited', () => {
    const dto = artworkDedupOperationDto(
      row({
        mode: 'PREPARE',
        originalAction: 'PREPARE',
        status: 'BUILDING',
        readerState: 'RUNNING',
        readerToken: 'private-token'
      }) as never
    )
    expect(dto.allowedActions).toEqual(['CANCEL'])
    expect(JSON.stringify(dto)).not.toContain('private-token')
  })
  it('projects durable titles and real receipt counts after business deletion without returning paths or private history', async () => {
    const visual = {
      evidenceVersion: 'visual-v1',
      leftArtworkId: 1,
      rightArtworkId: 2,
      leftFileCount: '2',
      rightFileCount: '3',
      pairedCount: '2',
      exactCount: '1',
      similarCount: '1',
      leftUnmatchedCount: '0',
      rightUnmatchedCount: '1',
      leftUncheckedCount: '0',
      rightUncheckedCount: '0'
    }
    const op = row({ status: 'DELETED', protocolVersion: 3, deleteStartedAt: date, deletedFiles: 3n })
    const tx = {
      artworkDedupOperation: { findUnique: vi.fn(async () => op) },
      artworkDedupOperationArtwork: {
        findMany: vi.fn(async () => [
          {
            artworkId: 1,
            groupId: 'g1',
            role: 'KEEPER',
            title: '冻结保留者',
            sourceLabel: 'LOCAL_CREATED',
            artworkCreatedAt: date,
            memberCount: 2n,
            fileCount: 3n,
            status: 'VERIFIED',
            errorCode: null
          },
          {
            artworkId: 2,
            groupId: 'g1',
            role: 'COPY',
            title: '冻结副本',
            sourceLabel: 'PIXIV_IMPORTED',
            artworkCreatedAt: date,
            memberCount: 2n,
            fileCount: 3n,
            status: 'DELETED',
            errorCode: null
          }
        ])
      },
      artwork: {
        findMany: vi.fn<
          (input: unknown) => Promise<
            {
              id: number
              title: string
              source: string
              createdAt: Date
              likes: { level: number }[]
              readingSummaries: never[]
            }[]
          >
        >(async () => [
          {
            id: 1,
            title: '当前实时标题',
            source: 'LOCAL_IMPORT',
            createdAt: new Date('2026-01-01'),
            likes: [{ level: 3 }],
            readingSummaries: []
          }
        ])
      },
      artworkDedupOperationGroup: {
        findMany: vi.fn(async () => [
          {
            groupId: 'g1',
            relationKind: 'VISUAL',
            visual,
            containedArtworkId: null,
            containerArtworkId: null,
            containedFileCount: null,
            containerFileCount: null
          }
        ])
      },
      artworkDedupOperationSource: {
        findMany: vi.fn(async () => [
          {
            artworkId: 2,
            sourceId: 'source-1',
            source: {
              kind: 'PATH',
              canonicalPath: '/private/media/a.jpg',
              generation: 4n,
              status: 'TOMBSTONE',
              ownerOperationId: 'op-1',
              displayName: '/private/media/a.jpg'
            }
          }
        ])
      },
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          { completedCopies: 1, remainingCopies: 0, blockedCopies: 0, remainingFiles: '0', deleteIntentFiles: '3' }
        ])
        .mockResolvedValueOnce([
          {
            artworkId: 1,
            bookmarksAvailable: 1,
            bookmarksUnavailable: 0,
            likesAvailable: 0,
            likesUnavailable: 0,
            other: true
          }
        ])
    }
    const response = await getArtworkDedupOperation(
      'user-a',
      { operationId: 'op-1', expectedUserId: 'user-a', preview: { kind: 'ARTWORKS', limit: 20 } },
      { $transaction: async (body) => body(tx as never) }
    )
    expect(response.operation.counts).toMatchObject({
      deleteIntentFiles: '3',
      deletedFiles: '3',
      completedCopies: 1,
      remainingFiles: '0'
    })
    if (response.preview?.kind !== 'ARTWORKS') throw new Error('Expected artworks')
    expect(response.preview.items[0]).toMatchObject({
      title: '冻结保留者',
      sourceLabel: 'LOCAL_CREATED',
      createdAt: date.toISOString(),
      personalRecords: 'CURRENT',
      ownOrganization: { rating: 3 },
      otherAccountHasOrganization: true
    })
    expect(response.preview.items[1]).toMatchObject({
      title: '冻结副本',
      relationKind: 'VISUAL',
      visual,
      personalRecords: 'REMOVED',
      mediaCount: '2',
      fileCount: '3',
      canAllowReimport: true,
      sources: [{ displayName: '原件 · a.jpg', generation: '4', status: 'TOMBSTONE' }]
    })
    expect(JSON.stringify(response)).not.toContain('/private/media')
    expect(tx.artwork.findMany.mock.calls[0]![0]).toMatchObject({
      select: { likes: { where: { userId: 'user-a' } }, readingSummaries: { where: { userId: 'user-a' } } }
    })
  })
})
