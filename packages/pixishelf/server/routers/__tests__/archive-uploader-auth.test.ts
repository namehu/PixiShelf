import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSource: vi.fn(),
  listSources: vi.fn(),
  getSource: vi.fn(),
  listItems: vi.fn(),
  setArchived: vi.fn(),
  triggerScan: vi.fn(),
  cancelScan: vi.fn(),
  addToInbox: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/archive-uploader/archive-uploader-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/archive-uploader/archive-uploader-service')>()),
  createArchiveUploaderSource: mocks.createSource,
  listArchiveUploaderSources: mocks.listSources,
  getArchiveUploaderSource: mocks.getSource,
  listArchiveUploaderScanItems: mocks.listItems,
  setArchiveUploaderSourceArchived: mocks.setArchived,
  triggerArchiveUploaderScan: mocks.triggerScan,
  cancelArchiveUploaderScan: mocks.cancelScan,
  addArchiveUploaderScanItems: mocks.addToInbox
}))

import { archiveUploaderRouter } from '../archive-uploader'

const authorized = {
  session: { id: 'session-1' },
  user: { id: 'admin-1' },
  userId: 'admin-1',
  headers: new Headers()
} as never
const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never

describe('archive uploader authorization boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listSources.mockResolvedValue([])
    mocks.getSource.mockResolvedValue({ source: {}, runs: [] })
    mocks.listItems.mockResolvedValue({ items: [], nextCursor: null })
  })

  it.each([
    {
      name: 'createSource',
      invoke: () =>
        archiveUploaderRouter.createCaller(unauthorized).createSource({ identityKind: 'UID', identityValue: '123' }),
      service: mocks.createSource
    },
    {
      name: 'setArchived',
      invoke: () =>
        archiveUploaderRouter.createCaller(unauthorized).setArchived({ sourceId: 'source-1', archived: true }),
      service: mocks.setArchived
    },
    {
      name: 'triggerScan',
      invoke: () =>
        archiveUploaderRouter.createCaller(unauthorized).triggerScan({ sourceId: 'source-1', mode: 'LATEST' }),
      service: mocks.triggerScan
    },
    {
      name: 'cancelScan',
      invoke: () =>
        archiveUploaderRouter.createCaller(unauthorized).cancelScan({ sourceId: 'source-1', runId: 'run-1' }),
      service: mocks.cancelScan
    },
    {
      name: 'addToInbox',
      invoke: () =>
        archiveUploaderRouter.createCaller(unauthorized).addToInbox({
          sourceId: 'source-1',
          submissionAttemptId: '00000000-0000-4000-8000-000000000001',
          itemIds: ['item-1']
        }),
      service: mocks.addToInbox
    }
  ])('rejects unauthenticated $name writes before the service boundary', async ({ invoke, service }) => {
    await expect(invoke()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(service).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated source reads before the service boundary', async () => {
    await expect(
      archiveUploaderRouter.createCaller(unauthorized).listSources({ includeArchived: true })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(
      archiveUploaderRouter.createCaller(unauthorized).getSource({ sourceId: 'source-1' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(
      archiveUploaderRouter.createCaller(unauthorized).listItems({ sourceId: 'source-1', limit: 50 })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(mocks.listSources).not.toHaveBeenCalled()
    expect(mocks.getSource).not.toHaveBeenCalled()
    expect(mocks.listItems).not.toHaveBeenCalled()
  })

  it('passes the authenticated user id only to scan and intake-producing writes', async () => {
    mocks.triggerScan.mockResolvedValue({ id: 'run-1' })
    mocks.cancelScan.mockResolvedValue({ id: 'run-1', status: 'CANCELLING' })
    mocks.addToInbox.mockResolvedValue({ id: 'submission-1' })

    await archiveUploaderRouter.createCaller(authorized).triggerScan({ sourceId: 'source-1', mode: 'LATEST' })
    await archiveUploaderRouter.createCaller(authorized).cancelScan({ sourceId: 'source-1', runId: 'run-1' })
    await archiveUploaderRouter.createCaller(authorized).addToInbox({
      sourceId: 'source-1',
      submissionAttemptId: '00000000-0000-4000-8000-000000000001',
      itemIds: ['item-1']
    })

    expect(mocks.triggerScan).toHaveBeenCalledWith({ sourceId: 'source-1', mode: 'LATEST' }, 'admin-1')
    expect(mocks.cancelScan).toHaveBeenCalledWith({ sourceId: 'source-1', runId: 'run-1' })
    expect(mocks.addToInbox).toHaveBeenCalledWith(
      {
        sourceId: 'source-1',
        submissionAttemptId: '00000000-0000-4000-8000-000000000001',
        itemIds: ['item-1']
      },
      'admin-1'
    )
  })
})
