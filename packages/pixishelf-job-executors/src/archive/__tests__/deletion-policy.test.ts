import { describe, expect, it, vi } from 'vitest'
import { assertArchiveImportNotDeleted } from '../deletion-policy.ts'
import type { ArchiveTransaction } from '../types.ts'

describe('archive import deletion fence', () => {
  it.each([
    { deletion: null, createdAt: '2026-10-01', allowed: true },
    { deletion: { purgedAt: null }, createdAt: '2026-10-12', allowed: false },
    { deletion: { purgedAt: new Date('2026-10-10') }, createdAt: '2026-10-01', allowed: false },
    { deletion: { purgedAt: new Date('2026-10-10') }, createdAt: '2026-10-10', allowed: false },
    { deletion: { purgedAt: new Date('2026-10-10') }, createdAt: '2026-10-12', allowed: true }
  ])('applies the purge boundary: $createdAt, allowed=$allowed', async ({ deletion, createdAt, allowed }) => {
    const tx = { archiveDeletedIdentity: { findUnique: vi.fn(async () => deletion) } } as unknown as ArchiveTransaction
    const result = assertArchiveImportNotDeleted(tx, {
      providerKey: 'test',
      externalId: '1',
      createdAt: new Date(createdAt)
    })
    if (allowed) await expect(result).resolves.toBeUndefined()
    else await expect(result).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })
})
