import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sources: vi.fn(),
  open: vi.fn(),
  page: vi.fn(),
  reload: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/archive-preview/archive-preview-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/archive-preview/archive-preview-service')>()),
  listArchivePreviewSources: mocks.sources,
  openArchivePreview: mocks.open,
  getArchivePreviewPage: mocks.page,
  reloadArchivePreview: mocks.reload
}))

import { archivePreviewRouter } from '../archive-preview'

const authorized = {
  session: { id: 'session-1' },
  user: { id: 'user-1' },
  userId: 'user-1',
  headers: new Headers()
} as never
const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never

describe('archive preview authorization boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sources.mockResolvedValue([])
    mocks.open.mockResolvedValue({
      previewId: 'preview-123456789',
      title: 'Gallery',
      total: 0,
      page: 0,
      items: [],
      nextPage: null
    })
    mocks.page.mockResolvedValue({ title: 'Gallery', total: 0, page: 0, items: [], nextPage: null })
    mocks.reload.mockResolvedValue({ title: 'Gallery', total: 0, page: 0, items: [], nextPage: null })
  })

  it('rejects every unauthenticated operation before preview service IO', async () => {
    const caller = archivePreviewRouter.createCaller(unauthorized)
    await expect(caller.sources({ artworkId: 1 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(caller.open({ source: { kind: 'url', url: 'https://e-hentai.org/g/1/token/' } })).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    })
    await expect(caller.page({ previewId: 'preview-123456789', page: 0 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    })
    await expect(caller.reload({ previewId: 'preview-123456789' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    })
    expect(mocks.sources).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.page).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
  })

  it('passes only the authenticated user identity to user-bound session operations', async () => {
    const caller = archivePreviewRouter.createCaller(authorized)
    await caller.sources({ artworkId: 7 })
    await caller.open({ source: { kind: 'task', taskId: 'task-1' } })
    await caller.page({ previewId: 'preview-123456789', page: 1 })
    await caller.reload({ previewId: 'preview-123456789' })

    expect(mocks.sources).toHaveBeenCalledWith({ artworkId: 7 })
    expect(mocks.open).toHaveBeenCalledWith({ source: { kind: 'task', taskId: 'task-1' } }, 'user-1')
    expect(mocks.page).toHaveBeenCalledWith({ previewId: 'preview-123456789', page: 1 }, 'user-1')
    expect(mocks.reload).toHaveBeenCalledWith({ previewId: 'preview-123456789' }, 'user-1')
  })
})
