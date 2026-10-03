import { beforeEach, describe, expect, it, vi } from 'vitest'

const writes = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/archive-uploader/archive-uploader-service', async (original) => ({
  ...(await original<typeof import('@/services/archive-uploader/archive-uploader-service')>()),
  createArchiveTitleSource: writes,
  getArchiveDiscoverySourceDeletePreview: writes,
  deleteArchiveDiscoverySource: writes,
  renameArchiveTitleSource: writes,
  setArchiveUploaderSourceArchived: writes,
  triggerArchiveUploaderScan: writes,
  cancelArchiveUploaderScan: writes,
  createArchiveUploaderSubmissionAttempt: writes,
  addArchiveUploaderScanItems: writes,
  ignoreArchiveUploaderScanItems: writes,
  restoreArchiveUploaderIgnoredItems: writes,
  getArchiveDiscoveryCatalogCounts: writes,
  listArchiveUploaderSources: writes,
  getArchiveUploaderSource: writes,
  listArchiveUploaderScanItems: writes,
  listArchiveUploaderIgnoredItems: writes
}))
import { archiveSearchRouter } from '../archive-search'
vi.mock('@/services/archive-uploader/discovery-creator-service', async (original) => ({
  ...(await original<typeof import('@/services/archive-uploader/discovery-creator-service')>()),
  setDiscoveryCreators: writes,
  bindDiscoveryItems: writes,
  cancelPendingCreators: writes,
  listPendingCreators: writes
}))

const caller = archiveSearchRouter.createCaller({ session: null, user: null, headers: new Headers() } as never)

beforeEach(() => writes.mockReset())

describe('archiveSearch authentication boundary', () => {
  it.each([
    () => caller.setDefaultCreators({ sourceId: 'one', artistIds: [] }),
    () =>
      caller.bindCreators({
        sourceId: 'one',
        artistIds: [1],
        itemIds: ['item'],
        requestId: '00000000-0000-4000-8000-000000000001'
      }),
    () => caller.cancelPendingCreators({ pendingIds: ['pending'], requestId: '00000000-0000-4000-8000-000000000001' }),
    () => caller.listPendingCreators({}),
    () => caller.getDeletePreview({ sourceId: 'one' }),
    () => caller.deleteSource({ sourceId: 'one' }),
    () => caller.createSource({ displayName: 'Example', keyword: 'abc' }),
    () => caller.renameSource({ sourceId: 'one', displayName: 'New name' }),
    () => caller.setArchived({ sourceId: 'one', archived: true }),
    () => caller.triggerScan({ sourceId: 'one', mode: 'LATEST' }),
    () => caller.cancelScan({ sourceId: 'one', runId: 'run' }),
    () => caller.createSubmissionAttempt({ sourceId: 'one', itemIds: ['item'] }),
    () =>
      caller.addToInbox({
        sourceId: 'one',
        itemIds: ['item'],
        submissionAttemptId: '00000000-0000-4000-8000-000000000001'
      }),
    () => caller.ignoreItems({ sourceId: 'one', itemIds: ['item'] }),
    () => caller.restoreIgnoredItems({ ignoredItemIds: ['item'] }),
    () => caller.catalogCounts({}),
    () => caller.listSources({}),
    () => caller.getSource({ sourceId: 'one' }),
    () => caller.listItems({ sourceId: 'one' }),
    () => caller.listIgnoredItems({})
  ])('rejects unauthenticated access without invoking services', async (invoke) => {
    await expect(invoke()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(writes).not.toHaveBeenCalled()
  })
})

describe('archiveSearch count options', () => {
  const authenticated = archiveSearchRouter.createCaller({
    session: { id: 'session' },
    user: { id: 'user' },
    headers: new Headers()
  } as never)

  it.each([undefined, true, false])('passes includeCounts=%s independently of source scope', async (includeCounts) => {
    const deps = { sourceKind: 'ALL', includeCounts: includeCounts ?? true }
    await authenticated.listSources({ includeCounts })
    expect(writes).toHaveBeenLastCalledWith({ includeArchived: true }, deps)
    await authenticated.getSource({ sourceId: 'one', includeCounts })
    expect(writes).toHaveBeenLastCalledWith({ sourceId: 'one' }, deps)
    await authenticated.listItems({ sourceId: 'one', includeCounts })
    expect(writes).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: 'one' }), deps)
    expect(writes.mock.lastCall?.[0]).not.toHaveProperty('includeCounts')
  })

  it('uses the authenticated all-source scope and validates unbound inputs', async () => {
    await authenticated.catalogCounts({})
    expect(writes).toHaveBeenLastCalledWith({ unboundOnly: false }, { sourceKind: 'ALL' })
    writes.mockClear()
    await expect(authenticated.catalogCounts({ unboundOnly: true })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(writes).not.toHaveBeenCalled()
  })
})
