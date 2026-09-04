import { describe, expect, it, vi } from 'vitest'

const writes = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/archive-uploader/archive-uploader-service', async (original) => ({
  ...(await original<typeof import('@/services/archive-uploader/archive-uploader-service')>()),
  createArchiveTitleSource: writes,
  renameArchiveTitleSource: writes,
  setArchiveUploaderSourceArchived: writes,
  triggerArchiveUploaderScan: writes,
  cancelArchiveUploaderScan: writes,
  createArchiveUploaderSubmissionAttempt: writes,
  addArchiveUploaderScanItems: writes,
  ignoreArchiveUploaderScanItems: writes,
  restoreArchiveUploaderIgnoredItems: writes,
  listArchiveUploaderSources: writes,
  getArchiveUploaderSource: writes,
  listArchiveUploaderScanItems: writes,
  listArchiveUploaderIgnoredItems: writes
}))
import { archiveSearchRouter } from '../archive-search'

const caller = archiveSearchRouter.createCaller({ session: null, user: null, headers: new Headers() } as never)

describe('archiveSearch authentication boundary', () => {
  it.each([
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
    () => caller.listSources({}),
    () => caller.getSource({ sourceId: 'one' }),
    () => caller.listItems({ sourceId: 'one' }),
    () => caller.listIgnoredItems({})
  ])('rejects unauthenticated access without invoking services', async (invoke) => {
    await expect(invoke()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(writes).not.toHaveBeenCalled()
  })
})
