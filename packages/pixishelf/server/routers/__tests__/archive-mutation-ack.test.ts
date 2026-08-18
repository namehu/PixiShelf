import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestAction: vi.fn(),
  retryTaskItem: vi.fn(),
  listTaskItems: vi.fn(),
  getTaskItemCounts: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/services/archive/archive-module', () => ({ archiveModule: mocks }))

import { archiveRouter } from '../archive'

const authorized = {
  session: { id: 'session-1' },
  user: { id: 'admin-1' },
  userId: 'admin-1',
  headers: new Headers()
} as never

describe('archive mutation acknowledgement contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const legacyUnsafeTaskView = {
      taskId: 'task-1',
      errorMessage: 'upstream token and local staging path',
      items: [{ errorMessage: 'private remote response' }]
    }
    mocks.requestAction.mockResolvedValue(legacyUnsafeTaskView)
    mocks.retryTaskItem.mockResolvedValue(legacyUnsafeTaskView)
  })

  it('returns only taskId from archive.action', async () => {
    await expect(
      archiveRouter.createCaller(authorized).action({ taskId: 'task-1', action: 'CANCEL' })
    ).resolves.toEqual({ taskId: 'task-1' })
    expect(mocks.requestAction).toHaveBeenCalledWith('task-1', 'CANCEL', { requestedByUserId: 'admin-1' })
  })

  it('returns only taskId from archive.retryTaskItem', async () => {
    await expect(
      archiveRouter.createCaller(authorized).retryTaskItem({ taskId: 'task-1', itemId: 'item-1' })
    ).resolves.toEqual({ taskId: 'task-1' })
    expect(mocks.retryTaskItem).toHaveBeenCalledWith('task-1', 'item-1', { requestedByUserId: 'admin-1' })
  })
})
