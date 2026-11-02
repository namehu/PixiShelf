import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveModule } from '../archive-module'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), control: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { archiveImport: { findUnique: mocks.findUnique } } }))
vi.mock('../archive-download-control', () => ({ controlArchiveDownloads: mocks.control }))

describe('single download controls', () => {
  const module = new ArchiveModule()
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.findUnique.mockResolvedValue({ id: 'import-1', phase: 'DOWNLOAD', status: 'FAILED' })
    mocks.control.mockResolvedValue({ items: [{ result: 'APPLIED', relatedId: 'retry-job' }] })
  })

  it.each(['RETRY', 'RESUME'] as const)(
    'routes archive %s through the batch implementation without loading media or metadata',
    async (action) => {
      await expect(module.requestAction('import-1', action, { requestedByUserId: 'admin' })).resolves.toEqual({
        taskId: 'import-1'
      })
      expect(mocks.findUnique).toHaveBeenCalledWith({
        where: { id: 'import-1' },
        select: { phase: true, status: true }
      })
      expect(mocks.control).toHaveBeenCalledWith(
        expect.objectContaining({ taskIds: ['import-1'], action, requestedByUserId: 'admin' })
      )
    }
  )

  it('binds a background job control to the originally requested job', async () => {
    await expect(module.requestJobAction('old-job', 'RETRY', 'admin')).resolves.toEqual({ taskId: 'import-1' })
    expect(mocks.control).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSystemJobId: 'old-job', taskIds: ['import-1'] })
    )
  })

  it('passes only the selected item intent and preserves the mutation acknowledgement', async () => {
    await expect(module.retryTaskItem('import-1', 'failed-item', { requestedByUserId: 'admin' })).resolves.toEqual({
      taskId: 'import-1'
    })
    expect(mocks.control).toHaveBeenCalledWith(expect.objectContaining({ retryItemId: 'failed-item', action: 'RETRY' }))
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 'import-1' }, select: { phase: true } })
  })

  it.each(['FAILED', 'PAUSED'] as const)('retains display quality control for %s downloads', async (status) => {
    mocks.findUnique.mockResolvedValue({ id: 'import-1', phase: 'DOWNLOAD', status })
    await module.requestAction('import-1', 'USE_DISPLAY_QUALITY', { requestedByUserId: 'admin' })
    expect(mocks.control).toHaveBeenCalledWith(
      expect.objectContaining({ action: status === 'FAILED' ? 'RETRY' : 'RESUME', useDisplayQuality: true })
    )
  })

  it('returns a domain conflict when the shared control rejected the target', async () => {
    mocks.control.mockResolvedValue({ items: [{ result: 'CONFLICT', message: '归档任务正在清理暂存文件' }] })
    await expect(module.requestAction('import-1', 'RETRY', { requestedByUserId: 'admin' })).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
      message: '归档任务正在清理暂存文件'
    })
  })
})
