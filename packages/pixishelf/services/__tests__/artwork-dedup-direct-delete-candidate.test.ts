// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
const database = vi.hoisted(() => ({
  $transaction: vi.fn(async (body: (tx: unknown) => unknown) =>
    body({ artworkDedupCommand: { findUnique: async () => null }, workerInstance: { findMany: async () => [] } })
  )
}))
vi.mock('@/lib/prisma', () => ({ prisma: database }))
import {
  ARTWORK_DEDUP_DIRECT_DELETE_ENABLED,
  ARTWORK_DEDUP_RELEASE_STAGE,
  isArtworkDedupMaintenanceModeEnabled
} from '@pixishelf/job-contracts'
import { artworkDedupRouter } from '@/server/routers/artwork-dedup'
import type { Context } from '@/server/context'
const context = {
  headers: new Headers(),
  user: { id: 'candidate-actor' },
  session: { id: 'session' },
  userId: 'candidate-actor'
} as Context
const command = {
  expectedUserId: 'candidate-actor',
  operationId: 'operation',
  expectedVersion: 1,
  idempotencyKey: 'key'
}
const confirmation = {
  ...command,
  purpose: 'DIRECT_DELETE' as const,
  protocolVersion: 1 as const,
  scopeDigest: 'a'.repeat(64),
  externalWritesStopped: true as const,
  permanentDeleteConfirmed: true as const,
  organizationImpactConfirmed: true as const
}
describe('real direct-delete release candidate', () => {
  it('keeps the retired direct-delete route read-only even when old release flags are enabled', async () => {
    expect(ARTWORK_DEDUP_DIRECT_DELETE_ENABLED).toBe(true)
    expect(ARTWORK_DEDUP_RELEASE_STAGE).toBe(3)
    for (const mode of ['ISOLATE', 'RESTORE', 'PURGE'] as const) {
      expect(isArtworkDedupMaintenanceModeEnabled(mode)).toBe(false)
    }
    expect(isArtworkDedupMaintenanceModeEnabled('PREPARE', 'PURGE')).toBe(false)
    const caller = artworkDedupRouter.createCaller(context)
    await expect(caller.directDelete(confirmation)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(database.$transaction).not.toHaveBeenCalled()
  })
  it('rejects old protocols, unconfirmed consequences, arbitrary scope and anonymous or switched accounts before transactions', async () => {
    database.$transaction.mockClear()
    const caller = artworkDedupRouter.createCaller(context)
    for (const changes of [
      { purpose: 'ISOLATION' },
      { protocolVersion: 0 },
      { scopeDigest: null },
      { externalWritesStopped: false },
      { permanentDeleteConfirmed: false },
      { organizationImpactConfirmed: false },
      { paths: ['/not-authorized'] },
      { userId: 'forged' }
    ]) {
      await expect(caller.directDelete({ ...confirmation, ...changes } as never)).rejects.toMatchObject({
        code: 'BAD_REQUEST'
      })
    }
    await expect(caller.directDelete({ ...confirmation, expectedUserId: 'switched' })).rejects.toMatchObject({
      code: 'FORBIDDEN'
    })
    const anonymous = artworkDedupRouter.createCaller({
      ...context,
      user: undefined,
      session: undefined,
      userId: undefined
    })
    await expect(anonymous.directDelete(confirmation)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(database.$transaction).not.toHaveBeenCalled()
  })
})
