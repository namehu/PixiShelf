import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  preview: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/setting.service', () => ({
  getScanPath: vi.fn(),
  setScanPath: vi.fn(),
  getSystemSettings: vi.fn(),
  upsertSystemSettings: vi.fn()
}))
vi.mock('@/services/archive-default-tag-backfill-service', () => ({
  ArchiveDefaultTagBackfillServiceError: class ArchiveDefaultTagBackfillServiceError extends Error {},
  getArchiveDefaultTagBackfillStatus: mocks.status,
  previewArchiveDefaultTagBackfill: mocks.preview,
  startArchiveDefaultTagBackfill: mocks.start,
  cancelArchiveDefaultTagBackfill: mocks.cancel
}))

import { settingRouter } from '../setting'

const authorized = {
  session: { id: 'session-1' },
  user: { id: 'admin-1' },
  userId: 'admin-1',
  headers: new Headers()
} as never
const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never
const digest = 'a'.repeat(64)

describe('setting archive default-tag backfill authorization', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['status', () => settingRouter.createCaller(unauthorized).getArchiveDefaultTagBackfillStatus(), mocks.status],
    ['preview', () => settingRouter.createCaller(unauthorized).previewArchiveDefaultTagBackfill(), mocks.preview],
    [
      'start',
      () => settingRouter.createCaller(unauthorized).startArchiveDefaultTagBackfill({ snapshotDigest: digest }),
      mocks.start
    ],
    [
      'cancel',
      () => settingRouter.createCaller(unauthorized).cancelArchiveDefaultTagBackfill({ jobId: 'job-1' }),
      mocks.cancel
    ]
  ])('rejects unauthenticated %s before calling its service', async (_name, invoke, service) => {
    await expect(invoke()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(service).not.toHaveBeenCalled()
  })

  it('passes the authenticated user and strict frozen preview input to the start service', async () => {
    mocks.start.mockResolvedValue({ jobId: 'job-1', status: 'PENDING', reused: false })

    await expect(
      settingRouter.createCaller(authorized).startArchiveDefaultTagBackfill({ snapshotDigest: digest })
    ).resolves.toEqual({ jobId: 'job-1', status: 'PENDING', reused: false })
    expect(mocks.start).toHaveBeenCalledWith({ requestedByUserId: 'admin-1', snapshotDigest: digest })

    await expect(
      settingRouter
        .createCaller(authorized)
        .startArchiveDefaultTagBackfill({ snapshotDigest: digest, defaultTagIds: [1] } as never)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(mocks.start).toHaveBeenCalledOnce()
  })
})
