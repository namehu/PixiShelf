import { describe, expect, it, vi } from 'vitest'
import {
  archiveIntakeListSchema,
  archiveIntakeManySchema,
  createArchiveIntakeSchema,
  hashSubmittedUrl,
  listArchiveIntakeItems,
  replaceArchiveIntakeItem,
  replaceArchiveIntakeSchema
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

  it('keeps replace input strict and bounds one corrected URL', () => {
    expect(
      replaceArchiveIntakeSchema.safeParse({
        idempotencyKey: 'replace-1',
        itemId: 'item-1',
        url: 'https://e-hentai.org/g/2/new-token/'
      }).success
    ).toBe(true)
    expect(
      replaceArchiveIntakeSchema.safeParse({
        idempotencyKey: 'replace-1',
        itemId: 'item-1',
        url: `https://e-hentai.org/g/2/${'x'.repeat(2_100)}/`
      }).success
    ).toBe(false)
    expect(
      replaceArchiveIntakeSchema.safeParse({
        idempotencyKey: 'replace-1',
        itemId: 'item-1',
        url: 'https://e-hentai.org/g/2/new-token/',
        retryOriginal: true
      }).success
    ).toBe(false)
  })

  it.each([
    'http://e-hentai.org/g/2/token/',
    'https://user:secret@e-hentai.org/g/2/token/',
    'https://e-hentai.org:8443/g/2/token/',
    'https://127.0.0.1/g/2/token/'
  ])('rejects an unsafe or unsupported replacement URL before any write: %s', async (url) => {
    const transaction = {
      $queryRaw: vi.fn(),
      archiveIntakeSubmission: { findUnique: vi.fn().mockResolvedValue(null) },
      archiveIntakeItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'item-1',
          status: 'FAILED',
          submittedUrl: 'https://e-hentai.org/g/1/old-token/'
        }),
        count: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn()
      },
      systemJob: { create: vi.fn() }
    }
    const database = { $transaction: vi.fn((callback) => callback(transaction)) }

    await expect(
      replaceArchiveIntakeItem({ idempotencyKey: `replace-${url}`, itemId: 'item-1', url }, 'admin-1', {
        database: database as never
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_URL|UNSUPPORTED_PROVIDER|SSRF_BLOCKED/) })
    expect(transaction.archiveIntakeItem.create).not.toHaveBeenCalled()
    expect(transaction.systemJob.create).not.toHaveBeenCalled()
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

  it('replaces persisted internal exception details with a fixed wire message', async () => {
    const page = await listArchiveIntakeItems(
      { view: 'FAILED', limit: 1 },
      {
        database: {
          archiveIntakeItem: {
            findMany: async () => [
              intakeRecord({
                status: 'FAILED',
                errorCode: 'INTERNAL',
                errorMessage: 'Prisma failed at /private/archive/secret/item.webp'
              })
            ]
          }
        } as never
      }
    )

    expect(page.items[0]?.errorMessage).toBe('内部处理失败，请稍后重试或查看服务日志。')
    expect(JSON.stringify(page)).not.toContain('/private/archive')
    expect(JSON.stringify(page)).not.toContain('Prisma')
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

  it('locates one intake item by id without inheriting the current view filters', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    await listArchiveIntakeItems(
      { itemId: 'item-duplicate', view: 'ACTIVE', cursor: 'ignored-for-direct-lookup' },
      { database: { archiveIntakeItem: { findMany } } as never }
    )
    expect(findMany.mock.calls[0]![0].where).toEqual({ id: 'item-duplicate' })
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
