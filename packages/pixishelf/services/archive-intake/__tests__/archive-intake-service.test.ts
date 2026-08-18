import { describe, expect, it, vi } from 'vitest'
import {
  archiveIntakeListSchema,
  archiveIntakeManySchema,
  createArchiveIntakeSchema,
  hashSubmittedUrl,
  listArchiveIntakeItems
} from '../archive-intake-service'
import { enqueueArchiveIntakeManySchema } from '../archive-intake-enqueue-service'
import { redactArchiveUrl } from '@/services/archive/archive-redaction'

describe('archive intake input and wire safety', () => {
  it('enforces create and bulk limits at the service boundary', () => {
    expect(
      createArchiveIntakeSchema.safeParse({
        idempotencyKey: 'request-1',
        urls: Array.from({ length: 101 }, (_, index) => `https://e-hentai.org/g/${index}/token/`)
      }).success
    ).toBe(false)
    expect(
      archiveIntakeManySchema.safeParse({
        idempotencyKey: 'bulk-1',
        itemIds: Array.from({ length: 101 }, (_, index) => `item-${index}`)
      }).success
    ).toBe(false)
    expect(
      enqueueArchiveIntakeManySchema.safeParse({
        idempotencyKey: 'enqueue-1',
        items: Array.from({ length: 101 }, (_, index) => ({ itemId: `item-${index}`, quality: 'ORIGINAL' }))
      }).success
    ).toBe(false)
    expect(
      enqueueArchiveIntakeManySchema.safeParse({
        idempotencyKey: 'enqueue-duplicate',
        items: [
          { itemId: 'item-1', quality: 'ORIGINAL' },
          { itemId: 'item-1', quality: 'DISPLAY' }
        ]
      }).success
    ).toBe(false)
  })

  it('hashes the trimmed submitted string without reordering token-bearing query parameters', () => {
    expect(hashSubmittedUrl('  https://e-hentai.org/g/1/token/?b=2&a=1  ')).toBe(
      hashSubmittedUrl('https://e-hentai.org/g/1/token/?b=2&a=1')
    )
    expect(hashSubmittedUrl('https://e-hentai.org/g/1/token/?b=2&a=1')).not.toBe(
      hashSubmittedUrl('https://e-hentai.org/g/1/token/?a=1&b=2')
    )
  })

  it('never exposes locator tokens or query values in a list URL', () => {
    const masked = redactArchiveUrl('https://e-hentai.org/g/123/private-token/?token=secret')
    expect(masked).toBe('https://e-hentai.org/g/…')
    expect(masked).not.toContain('private-token')
    expect(masked).not.toContain('secret')
  })

  it('uses a stable tie-break cursor and combines search with the cursor filter', async () => {
    const first = intakeRecord({ id: 'item-b', queueOrder: BigInt(10) })
    const second = intakeRecord({ id: 'item-c', queueOrder: BigInt(10) })
    const findMany = vi.fn().mockResolvedValueOnce([first, second]).mockResolvedValueOnce([])
    const database = { archiveIntakeItem: { findMany } }

    const page = await listArchiveIntakeItems(
      { view: 'ACTIVE', limit: 1, search: 'gallery' },
      { database: database as never, now: () => new Date('2026-08-18T00:00:00.000Z') }
    )
    expect(page.items[0]).toMatchObject({
      id: 'item-b',
      submittedUrl: 'https://e-hentai.org/g/…',
      canonicalUrl: 'https://e-hentai.org/g/…',
      queueOrder: '10'
    })
    expect(JSON.stringify(page)).not.toContain('private-token')
    expect(JSON.stringify(page)).not.toContain('error-path-token')
    expect(JSON.stringify(page)).not.toContain('private-locator')

    await listArchiveIntakeItems(
      { view: 'ACTIVE', limit: 1, search: 'gallery', cursor: page.nextCursor! },
      { database: database as never }
    )
    const where = findMany.mock.calls[1]![0].where
    expect(where.AND).toHaveLength(2)
    expect(where.AND[0]).toHaveProperty('OR')
    expect(where.AND[1]).toEqual({
      OR: [{ queueOrder: { gt: BigInt(10) } }, { queueOrder: BigInt(10), id: { gt: 'item-b' } }]
    })
  })

  it('rejects a cursor bound to another inbox view', async () => {
    const findMany = vi.fn().mockResolvedValue([intakeRecord(), intakeRecord({ id: 'item-next' })])
    const page = await listArchiveIntakeItems(
      { view: 'ACTIVE', limit: 1 },
      { database: { archiveIntakeItem: { findMany } } as never }
    )
    await expect(
      listArchiveIntakeItems(
        { view: 'FAILED', limit: 1, cursor: page.nextCursor! },
        { database: { archiveIntakeItem: { findMany: vi.fn() } } as never }
      )
    ).rejects.toMatchObject({ code: 'INVALID_URL' })
  })

  it('keeps list input strict so unknown filter fields cannot reach Prisma', () => {
    expect(archiveIntakeListSchema.safeParse({ view: 'ACTIVE', locator: { token: 'secret' } }).success).toBe(false)
  })
})

function intakeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-a',
    submissionId: 'submission-1',
    submittedUrl: 'https://e-hentai.org/g/123/private-token/?token=secret',
    queueOrder: BigInt(9),
    status: 'READY',
    attempts: 1,
    availableAt: new Date('2026-08-18T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    providerKey: 'e-hentai',
    externalId: '123',
    canonicalUrl: 'https://e-hentai.org/g/123/private-token/',
    resolvedTitle: 'Gallery',
    thumbnailUrl: 'https://ehgt.org/thumb.jpg?token=private',
    pageCount: 10,
    resolutionKind: 'NEW',
    duplicateOfItemId: null,
    activeArchiveImportId: null,
    selectedQuality: 'ORIGINAL',
    resolvedAt: new Date('2026-08-18T00:00:00.000Z'),
    expiresAt: new Date('2026-08-19T00:00:00.000Z'),
    archiveImportId: null,
    errorCode: null,
    errorMessage:
      'failed https://e-hentai.org/g/123/error-path-token/ locator=private-locator token=private-error-token',
    errorStage: null,
    retryable: false,
    supersedesItemId: null,
    currentSystemJobId: 'job-1',
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    ...overrides
  }
}
