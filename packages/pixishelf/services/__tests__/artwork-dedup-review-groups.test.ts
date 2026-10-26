// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@pixishelf/db'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('../artwork-dedup-cover', () => ({ artworkDedupCoverUrls: vi.fn(async () => new Map()) }))
vi.mock('@pixishelf/job-contracts', async (original) => ({
  ...(await original<typeof import('@pixishelf/job-contracts')>()),
  isArtworkDedupMaintenanceModeEnabled: () => true
}))
import { listArtworkDedupReviewGroups } from '../artwork-dedup-review-service'

const visual = {
  evidenceVersion: 'sha256-multiset-overlap-v1',
  leftArtworkId: 1,
  rightArtworkId: 2,
  leftFileCount: '5',
  rightFileCount: '5',
  pairedCount: '4',
  exactCount: '4',
  similarCount: '0',
  leftUnmatchedCount: '1',
  rightUnmatchedCount: '1',
  leftUncheckedCount: '0',
  rightUncheckedCount: '0'
}

describe('partial review projection', () => {
  it.each([false, true])(
    'never recommends a keeper for a partial pair, including saved decisions (%s)',
    async (saved) => {
      const tx = {
        artworkDedupRun: { findUnique: vi.fn(async () => ({ id: 'run-1', status: 'COMPLETED', version: 4 })) },
        artworkDedupReviewState: { findUnique: vi.fn(async () => ({ reviewRevision: saved ? 1 : 0 })) },
        artwork: {
          findMany: vi.fn(async () =>
            [1, 2].map((id) => ({
              id,
              title: `作品 ${id}`,
              source: 'LOCAL_CREATED',
              createdAt: new Date('2026-10-26T00:00:00Z'),
              likes: [],
              readingSummaries: []
            }))
          )
        },
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([
            {
              groupId: 'partial-1',
              relationKind: 'PARTIAL',
              visual,
              containedArtworkId: null,
              containerArtworkId: null,
              containedFileCount: null,
              containerFileCount: null,
              memberCount: 2,
              fileCount: 5n,
              keeperArtworkId: saved ? 2 : null,
              reviewVersion: saved ? 1 : 0,
              saved,
              protectedCount: 0,
              eligible: true,
              reason: saved ? 'SAVED' : 'NEEDS_CHOICE'
            }
          ])
          .mockResolvedValueOnce([{ artworkId: 1 }, { artworkId: 2 }])
          .mockResolvedValueOnce(
            [1, 2].map((artworkId) => ({
              artworkId,
              bookmarksAvailable: 0,
              bookmarksUnavailable: 0,
              likesAvailable: 0,
              likesUnavailable: 0,
              other: false
            }))
          )
      }
      const database = {
        $transaction: async <T>(body: (value: Prisma.TransactionClient) => Promise<T>) => body(tx as never)
      }
      const page = await listArtworkDedupReviewGroups(
        'user-a',
        { expectedUserId: 'user-a', runId: 'run-1', groupId: 'partial-1', limit: 20 },
        database
      )
      if (page.kind !== 'MEMBERS') throw new Error('Expected member page')
      expect(page.group).toMatchObject({
        relationKind: 'PARTIAL',
        visual,
        recommendedKeeperArtworkId: null,
        eligibility: saved ? 'ELIGIBLE' : 'NEEDS_CHOICE',
        needsExplicitChoice: !saved,
        reasons: saved ? [] : ['EXPLICIT_CHOICE_REQUIRED']
      })
      expect(page.group.savedReview).toEqual(
        saved ? { groupId: 'partial-1', keeperArtworkId: 2, reviewVersion: 1 } : null
      )
      expect(page.keeper?.artworkId ?? null).toBe(saved ? 2 : null)
      expect(JSON.stringify(page)).not.toMatch(/path|lease|[a-f0-9]{64}/)
    }
  )
})
