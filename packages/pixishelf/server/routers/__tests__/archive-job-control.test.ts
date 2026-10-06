import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getJob: vi.fn(), control: vi.fn(), findImport: vi.fn(), generic: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: () => true } }))
vi.mock('@/lib/prisma', () => ({ prisma: { archiveImport: { findUniqueOrThrow: mocks.findImport } } }))
vi.mock('@/services/archive/archive-module', () => ({ archiveModule: { requestJobAction: mocks.control } }))
vi.mock('@/services/background-task', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getJobById: mocks.getJob,
  resumeJobCommand: mocks.generic,
  retryJobCommand: mocks.generic,
  pauseJobCommand: mocks.generic,
  cancelJobCommand: mocks.generic
}))
import { jobRouter } from '../job'

const ctx = { session: { id: 'session' }, user: { id: 'admin-1' }, userId: 'admin-1', headers: new Headers() } as any

describe('background archive controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getJob.mockResolvedValue({ id: 'job-1', type: 'ARCHIVE_IMPORT', status: 'PAUSED' })
    mocks.control.mockResolvedValue({ taskId: 'import-1' })
    mocks.findImport.mockResolvedValue({ systemJobId: 'job-1' })
  })

  it.each([
    ['resumeBackgroundJob', 'RESUME'],
    ['retryBackgroundJob', 'RETRY'],
    ['pauseBackgroundJob', 'PAUSE'],
    ['cancelBackgroundJob', 'CANCEL']
  ] as const)('%s uses the archive transaction and authenticated administrator', async (method, action) => {
    await jobRouter.createCaller(ctx)[method]({ jobId: 'job-1' })
    expect(mocks.control).toHaveBeenCalledWith('job-1', action, 'admin-1')
    expect(mocks.generic).not.toHaveBeenCalled()
  })

  it('returns the newly bound job after retry', async () => {
    mocks.findImport.mockResolvedValue({ systemJobId: 'job-2' })
    mocks.getJob
      .mockResolvedValueOnce({ id: 'job-1', type: 'ARCHIVE_IMPORT', status: 'FAILED' })
      .mockResolvedValueOnce({ id: 'job-2', type: 'ARCHIVE_IMPORT', status: 'PENDING' })
    await expect(jobRouter.createCaller(ctx).retryBackgroundJob({ jobId: 'job-1' })).resolves.toMatchObject({
      id: 'job-2'
    })
  })

  it('rejects unauthenticated control before touching archive data', async () => {
    await expect(
      jobRouter.createCaller({ ...ctx, user: null, session: null }).resumeBackgroundJob({ jobId: 'job-1' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(mocks.control).not.toHaveBeenCalled()
  })
})
