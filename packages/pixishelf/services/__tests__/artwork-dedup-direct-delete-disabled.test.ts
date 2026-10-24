// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
const database = vi.hoisted(() => ({
  $transaction: vi.fn(() => {
    throw new Error('unexpected database work')
  })
}))
vi.mock('@/lib/prisma', () => ({ prisma: database }))
// Explicit closed release fixture, independent of a later isolated candidate.
vi.mock('@pixishelf/job-contracts', async (original) => {
  const actual = await original<typeof import('@pixishelf/job-contracts')>()
  return {
    ...actual,
    ARTWORK_DEDUP_DIRECT_DELETE_ENABLED: false,
    isArtworkDedupMaintenanceModeEnabled: (mode: Parameters<typeof actual.isArtworkDedupMaintenanceModeEnabled>[0], purpose: Parameters<typeof actual.isArtworkDedupMaintenanceModeEnabled>[1]) => mode === 'DIRECT_DELETE' || purpose === 'DIRECT_DELETE' ? false : actual.isArtworkDedupMaintenanceModeEnabled(mode, purpose)
  }
})
import { ARTWORK_DEDUP_DIRECT_DELETE_ENABLED, ARTWORK_DEDUP_RELEASE_STAGE } from '@pixishelf/job-contracts'
import { artworkDedupRouter } from '@/server/routers/artwork-dedup'
import type { Context } from '@/server/context'
const context = {
  headers: new Headers(),
  user: { id: 'actor' },
  session: { id: 'session' },
  userId: 'actor'
} as Context
const command = { expectedUserId: 'actor', operationId: 'operation', expectedVersion: 1, idempotencyKey: 'key' }
describe('explicit closed direct-delete release fixture', () => {
  it('keeps new PREPARE, delete and reimport disabled before any transaction', async () => {
    expect(ARTWORK_DEDUP_DIRECT_DELETE_ENABLED).toBe(false)
    expect(ARTWORK_DEDUP_RELEASE_STAGE).toBe(3)
    const caller = artworkDedupRouter.createCaller(context)
    const inputs = [
      caller.prepareCleanup({
        expectedUserId: 'actor',
        purpose: 'DIRECT_DELETE',
        protocolVersion: 1,
        runId: 'run',
        expectedRunVersion: 1,
        expectedReviewRevision: 0,
        selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] },
        idempotencyKey: 'prepare'
      }),
      caller.directDelete({
        ...command,
        purpose: 'DIRECT_DELETE',
        protocolVersion: 1,
        scopeDigest: 'a'.repeat(64),
        externalWritesStopped: true,
        permanentDeleteConfirmed: true,
        organizationImpactConfirmed: true
      }),
      caller.allowReimport({ ...command, sources: [{ sourceId: 'source', expectedGeneration: '1' }] })
    ]
    for (const result of inputs) await expect(result).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(database.$transaction).not.toHaveBeenCalled()
  })
  it('rejects anonymous callers and literal-false confirmation at the transport boundary', async () => {
    const anonymous = artworkDedupRouter.createCaller({
      ...context,
      user: undefined,
      session: undefined,
      userId: undefined
    })
    await expect(
      anonymous.directDelete({
        ...command,
        purpose: 'DIRECT_DELETE',
        protocolVersion: 1,
        scopeDigest: 'a'.repeat(64),
        externalWritesStopped: true,
        permanentDeleteConfirmed: true,
        organizationImpactConfirmed: true
      })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    const caller = artworkDedupRouter.createCaller(context)
    await expect(
      caller.directDelete({
        ...command,
        purpose: 'DIRECT_DELETE',
        protocolVersion: 1,
        scopeDigest: 'a'.repeat(64),
        externalWritesStopped: false,
        permanentDeleteConfirmed: true,
        organizationImpactConfirmed: true
      } as never)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(database.$transaction).not.toHaveBeenCalled()
  })
})
