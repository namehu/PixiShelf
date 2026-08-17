import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  getActiveMigrationJob: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/migration-service', () => ({ precheckMigration: vi.fn() }))
vi.mock('@/services/background-task/dispatcher-cutover', () => ({
  isCentralDispatcherCutoverEnabled: () => true
}))
vi.mock('@/services/job-service', () => ({
  getJob: mocks.getJob,
  getActiveMigrationJob: mocks.getActiveMigrationJob
}))
vi.mock('@/services/background-task/job-command-service', () => ({
  pauseJobCommand: mocks.pause,
  resumeJobCommand: mocks.resume,
  cancelJobCommand: mocks.cancel,
  retryJobCommand: mocks.retry
}))

import { migrationRouter } from '../migration'

const ctx = {
  session: { id: 'session-1' },
  user: { id: 'admin-1' },
  userId: 'admin-1',
  headers: new Headers()
} as any

const validPayload = {
  selection: { mode: 'ARTWORK_IDS', artworkIds: [7] },
  safety: { transferMode: 'move', verifyAfterCopy: true, cleanupSource: true }
}

describe('migration central control domain boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pause.mockResolvedValue({ id: 'migration-1', status: 'PAUSED' })
  })

  it('rejects an explicit job from another domain without issuing a command', async () => {
    mocks.getJob.mockResolvedValue({
      id: 'scan-1',
      type: 'SCAN',
      definitionVersion: 1,
      payload: { mode: 'INCREMENTAL' }
    })

    await expect(migrationRouter.createCaller(ctx).control({ action: 'pause', jobId: 'scan-1' })).rejects.toMatchObject(
      { code: 'NOT_FOUND' }
    )
    expect(mocks.pause).not.toHaveBeenCalled()
  })

  it('rejects an unsupported migration definition version without issuing a command', async () => {
    mocks.getJob.mockResolvedValue({
      id: 'migration-v2',
      type: 'MIGRATION',
      definitionVersion: 2,
      payload: validPayload
    })

    await expect(
      migrationRouter.createCaller(ctx).control({ action: 'pause', jobId: 'migration-v2' })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(mocks.pause).not.toHaveBeenCalled()
  })

  it('rejects an invalid v1 migration payload without issuing a command', async () => {
    mocks.getJob.mockResolvedValue({ id: 'migration-invalid', type: 'MIGRATION', definitionVersion: 1, payload: {} })

    await expect(
      migrationRouter.createCaller(ctx).control({ action: 'pause', jobId: 'migration-invalid' })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(mocks.pause).not.toHaveBeenCalled()
  })

  it('issues a command only after the migration v1 payload passes validation', async () => {
    mocks.getJob.mockResolvedValue({
      id: 'migration-1',
      type: 'MIGRATION',
      definitionVersion: 1,
      payload: validPayload
    })

    await expect(migrationRouter.createCaller(ctx).control({ action: 'pause', jobId: 'migration-1' })).resolves.toEqual(
      { jobId: 'migration-1', status: 'PAUSED' }
    )
    expect(mocks.pause).toHaveBeenCalledWith({ jobId: 'migration-1' })
  })
})
