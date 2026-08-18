import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  replace: vi.fn(),
  list: vi.fn(),
  summary: vi.fn(),
  pause: vi.fn(),
  cancelMany: vi.fn(),
  retryMany: vi.fn(),
  enqueueMany: vi.fn(),
  actionMany: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/archive-intake/archive-intake-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/archive-intake/archive-intake-service')>()),
  createArchiveIntakeSubmission: mocks.create,
  replaceArchiveIntakeItem: mocks.replace,
  listArchiveIntakeItems: mocks.list,
  getArchiveIntakeSummary: mocks.summary,
  setArchiveIntakePaused: mocks.pause,
  cancelArchiveIntakeMany: mocks.cancelMany,
  retryArchiveIntakeMany: mocks.retryMany
}))
vi.mock('@/services/archive-intake/archive-intake-enqueue-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/archive-intake/archive-intake-enqueue-service')>()),
  enqueueArchiveIntakeMany: mocks.enqueueMany
}))
vi.mock('@/services/archive/archive-task-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/archive/archive-task-service')>()),
  actionArchiveTasksMany: mocks.actionMany
}))

import { archiveInboxRouter } from '../archive-inbox'
import { archiveRouter } from '../archive'

const authorized = {
  session: { id: 'session-1' },
  user: { id: 'admin-1' },
  userId: 'admin-1',
  headers: new Headers()
} as never
const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never

describe('archive inbox authorization boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({ id: 'submission-1' })
    mocks.list.mockResolvedValue({ items: [], nextCursor: null })
    mocks.summary.mockResolvedValue({ activeCount: 0 })
  })

  it.each([
    {
      mutation: 'create',
      invoke: () =>
        archiveInboxRouter.createCaller(unauthorized).create({
          idempotencyKey: 'request-1',
          urls: ['https://e-hentai.org/g/1/token/']
        }),
      service: mocks.create
    },
    {
      mutation: 'pause',
      invoke: () => archiveInboxRouter.createCaller(unauthorized).pause(),
      service: mocks.pause
    },
    {
      mutation: 'replace',
      invoke: () =>
        archiveInboxRouter.createCaller(unauthorized).replace({
          idempotencyKey: 'replace-1',
          itemId: 'item-1',
          url: 'https://e-hentai.org/g/2/new-token/'
        }),
      service: mocks.replace
    },
    {
      mutation: 'resume',
      invoke: () => archiveInboxRouter.createCaller(unauthorized).resume(),
      service: mocks.pause
    },
    {
      mutation: 'cancelMany',
      invoke: () =>
        archiveInboxRouter.createCaller(unauthorized).cancelMany({ idempotencyKey: 'cancel-1', itemIds: ['item-1'] }),
      service: mocks.cancelMany
    },
    {
      mutation: 'retryMany',
      invoke: () =>
        archiveInboxRouter.createCaller(unauthorized).retryMany({ idempotencyKey: 'retry-1', itemIds: ['item-1'] }),
      service: mocks.retryMany
    },
    {
      mutation: 'enqueueMany',
      invoke: () =>
        archiveInboxRouter.createCaller(unauthorized).enqueueMany({
          idempotencyKey: 'enqueue-1',
          items: [{ itemId: 'item-1', quality: 'ORIGINAL' }]
        }),
      service: mocks.enqueueMany
    }
  ])('rejects unauthenticated $mutation before its write service boundary', async ({ invoke, service }) => {
    await expect(invoke()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(service).not.toHaveBeenCalled()
    for (const writeService of [
      mocks.create,
      mocks.replace,
      mocks.pause,
      mocks.cancelMany,
      mocks.retryMany,
      mocks.enqueueMany
    ]) {
      expect(writeService).not.toHaveBeenCalled()
    }
  })

  it('rejects unauthenticated archive.actionMany before its write service boundary', async () => {
    await expect(
      archiveRouter.createCaller(unauthorized).actionMany({
        idempotencyKey: 'task-action-1',
        taskIds: ['task-1'],
        action: 'CANCEL'
      })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(mocks.actionMany).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated read without calling the query service', async () => {
    await expect(archiveInboxRouter.createCaller(unauthorized).summary()).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    })
    expect(mocks.summary).not.toHaveBeenCalled()
  })

  it('passes the authenticated user only to the admin write service', async () => {
    await archiveInboxRouter.createCaller(authorized).create({
      idempotencyKey: 'request-1',
      urls: ['https://e-hentai.org/g/1/token/']
    })
    expect(mocks.create).toHaveBeenCalledWith(
      { idempotencyKey: 'request-1', urls: ['https://e-hentai.org/g/1/token/'] },
      'admin-1'
    )
  })
})
