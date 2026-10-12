import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@pixishelf/db'
import { enqueueArchiveIntakeItemInTransaction } from '../intake-enqueue.ts'

describe('deleted identity enqueue boundary', () => {
  it.each([
    { mode: 'AUTO', autoOnly: false, purgedAt: new Date('2026-10-10'), createdAt: new Date('2026-10-11') },
    { mode: 'MANUAL', autoOnly: true, purgedAt: new Date('2026-10-10'), createdAt: new Date('2026-10-11') },
    { mode: 'MANUAL', autoOnly: false, purgedAt: null, createdAt: new Date('2026-10-11') },
    { mode: 'MANUAL', autoOnly: false, purgedAt: new Date('2026-10-10'), createdAt: new Date('2026-10-09') }
  ])(
    'blocks automatic, retained or stale intake: $mode / $autoOnly / $purgedAt',
    async ({ mode, autoOnly, purgedAt, createdAt }) => {
      const create = vi.fn()
      const tx = {
        $queryRawUnsafe: vi.fn(async () => []),
        archiveIntakeItem: {
          findUnique: vi.fn(async () => ({
            id: 'intake',
            status: 'READY',
            cancelRequestedAt: null,
            downloadMode: mode,
            createdAt,
            expiresAt: new Date('2026-10-14'),
            providerKey: 'test',
            externalId: '1',
            metadataHash: 'hash',
            resolvedSnapshot: { providerKey: 'test', externalId: '1', media: [] }
          }))
        },
        archiveDeletedIdentity: { findUnique: vi.fn(async () => ({ purgedAt })) },
        archiveImport: { create },
        systemJob: { create }
      } as unknown as Prisma.TransactionClient
      expect(
        await enqueueArchiveIntakeItemInTransaction(tx, 'intake', {
          quality: 'ORIGINAL',
          requestedByUserId: 'admin',
          timestamp: new Date('2026-10-12'),
          uuid: () => 'id',
          defaultTagIds: [],
          autoOnly
        })
      ).toMatchObject({ result: 'CONFLICT', code: 'ARCHIVE_DELETED' })
      expect(create).not.toHaveBeenCalled()
    }
  )
})
