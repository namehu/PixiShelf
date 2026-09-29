import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-handler'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), sourceUrl: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/services/background-task/request-auth', () => ({ requireAdminRequest: mocks.requireAdmin }))
vi.mock('@/services/archive-preview/archive-preview-service', () => ({
  getArchivePreviewSourceUrl: mocks.sourceUrl
}))

import { GET as getPreviewSource } from '../route'

const previewId = 'preview_1234567890'
const canonicalUrl = 'https://e-hentai.org/g/123/private123/'
const invoke = (id = previewId) =>
  getPreviewSource(new Request(`http://localhost/api/archive/preview/${previewId}/source?url=https://evil.test`), {
    params: Promise.resolve({ id })
  })

describe('archive preview source redirect route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ userId: 'user-1' })
    mocks.sourceUrl.mockReturnValue(canonicalUrl)
  })

  it('authenticates before reading process-local preview state', async () => {
    mocks.requireAdmin.mockRejectedValue(new ApiError('Unauthorized', 401))
    const response = await invoke()
    expect(response.status).toBe(401)
    expect(response.headers.get('location')).toBeNull()
    expect(mocks.sourceUrl).not.toHaveBeenCalled()
  })

  it('redirects only from the authenticated user-bound session and ignores query URLs', async () => {
    const response = await invoke()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(canonicalUrl)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(mocks.sourceUrl).toHaveBeenCalledWith(previewId, 'user-1')
  })

  it('rejects invalid ids before session lookup and returns a generic missing-session response', async () => {
    expect((await invoke('../private')).status).toBe(400)
    expect(mocks.sourceUrl).not.toHaveBeenCalled()

    mocks.sourceUrl.mockReturnValue(null)
    const missing = await invoke()
    expect(missing.status).toBe(404)
    expect(missing.headers.get('location')).toBeNull()
    expect(await missing.text()).not.toContain('private123')
  })

  it('never echoes or logs a private locator when session access fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.sourceUrl.mockImplementation(() => {
        throw new Error(canonicalUrl)
      })
      const response = await invoke()
      expect(response.status).toBe(500)
      expect(await response.text()).not.toContain('private123')
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
})
