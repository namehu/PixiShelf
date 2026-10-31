// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('../artwork-dedup-cover', () => ({ artworkDedupCoverUrls: vi.fn(async () => new Map()) }))
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
describe('retired deduplication operation display facts', () => {
  it('preserves deletion and stop-request facts while historical operations remain read-only', () => {
    for (const status of ['DRAINING', 'VERIFYING', 'DELETING']) {
      const before = artworkDedupOperationDto(row({ status }) as never)
      expect(before).toMatchObject({ status, allowedActions: [], deleteStartedAt: null, stopRequested: false })
      const after = artworkDedupOperationDto(row({ status, deleteStartedAt: date, cancelRequestedAt: date }) as never)
      expect(after).toMatchObject({
        status,
        allowedActions: [],
        deleteStartedAt: date.toISOString(),
        stopRequested: true
      })
    }
    const requested = artworkDedupOperationDto(row({ cancelRequestedAt: date }) as never)
    expect(requested.deleteStartedAt).toBeNull()
    expect(requested.stopRequested).toBe(true)
    expect(requested.allowedActions).toEqual([])
  })
  it('keeps historical protocol4 READY previews read-only regardless of reader activity', () => {
    const ready = row({ mode: 'PREPARE', originalAction: 'PREPARE', status: 'READY', protocolVersion: 4 })
    expect(artworkDedupOperationDto(ready as never)).toMatchObject({
      mode: 'PREPARE',
      status: 'READY',
      protocolVersion: 4,
      allowedActions: []
    })
    const activeReader = artworkDedupOperationDto({
      ...ready,
      readerState: 'RUNNING',
      readerToken: 'private-token'
    } as never)
    expect(activeReader.allowedActions).toEqual([])
    expect(activeReader).not.toHaveProperty('readerToken')
    expect(JSON.stringify(activeReader)).not.toContain('private-token')
  })
  it('keeps an active historical prepare reader read-only and hides its private token', () => {
    const dto = artworkDedupOperationDto(
      row({
        mode: 'PREPARE',
        originalAction: 'PREPARE',
        status: 'BUILDING',
        readerState: 'RUNNING',
        readerToken: 'private-token'
      }) as never
    )
    expect(dto).toMatchObject({
      mode: 'PREPARE',
      status: 'BUILDING',
      allowedActions: [],
      deleteStartedAt: null,
      stopRequested: false
    })
    expect(dto).not.toHaveProperty('readerToken')
    expect(JSON.stringify(dto)).not.toContain('private-token')
  })
  it.each(['VISUAL', 'PARTIAL'] as const)(
    'preserves read-only frozen %s evidence after deletion without exposing paths or enabling reimport',
    async (relationKind) => {
      const visual = {
        evidenceVersion: relationKind === 'PARTIAL' ? 'sha256-multiset-overlap-v1' : 'visual-v1',
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
        rightUncheckedCount: '0',
        ...(relationKind === 'PARTIAL'
          ? {
              leftFileCount: '5',
              rightFileCount: '5',
              pairedCount: '4',
              exactCount: '4',
              similarCount: '0',
              leftUnmatchedCount: '1',
              rightUnmatchedCount: '1'
            }
          : {})
      }
      const op = row({
        status: 'DELETED',
        protocolVersion: relationKind === 'PARTIAL' ? 4 : 3,
        deleteStartedAt: date,
        deletedFiles: 3n
      })
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
              relationKind,
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
      expect(response.operation).toMatchObject({
        allowedActions: [],
        deleteStartedAt: date.toISOString(),
        stopRequested: false
      })
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
        sourceLabel: 'PIXIV_IMPORTED',
        createdAt: date.toISOString(),
        relationKind,
        visual,
        personalRecords: 'REMOVED',
        mediaCount: '2',
        fileCount: '3',
        canAllowReimport: false,
        sources: [{ displayName: '原件 · a.jpg', generation: '4', status: 'TOMBSTONE' }]
      })
      expect(JSON.stringify(response)).not.toContain('/private/media')
      expect(tx.artwork.findMany.mock.calls[0]![0]).toMatchObject({
        select: { likes: { where: { userId: 'user-a' } }, readingSummaries: { where: { userId: 'user-a' } } }
      })
    }
  )
})
