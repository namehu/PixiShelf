import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), findUnique: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/lib/prisma', () => ({ prisma: { archiveImport: { findUnique: mocks.findUnique } } }))
import { GET as getSource } from '../route'

const canonicalUrl = 'https://e-hentai.org/g/123/private123/'
const invoke = (id = 'archive-id') =>
  getSource(new Request('http://localhost/api/archive/tasks/archive-id/source?url=https://evil.test'), {
    params: Promise.resolve({ id })
  })

describe('archive source redirect route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'admin' } })
    mocks.findUnique.mockResolvedValue({ providerKey: 'e-hentai', externalId: '123', canonicalUrl })
  })

  it.each([null, { user: {} }])('rejects missing or invalid sessions before reading private tasks', async (session) => {
    mocks.getSession.mockResolvedValue(session)
    const response = await invoke()
    expect(response.status).toBe(401)
    expect(response.headers.get('location')).toBeNull()
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('redirects a signed-in request to its validated task gallery, ignoring client URLs', async () => {
    const response = await invoke()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(canonicalUrl)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.text()).toBe('')
  })

  it('rejects an invalid task id before database access', async () => {
    expect((await invoke('../private')).status).toBe(400)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it.each([null, { providerKey: 'e-hentai', externalId: '123', canonicalUrl: 'https://evil.test/private123/' }])(
    'does not redirect missing tasks or unsafe locators',
    async (task) => {
      mocks.findUnique.mockResolvedValue(task)
      const response = await invoke()
      expect(response.status).toBe(404)
      expect(response.headers.get('location')).toBeNull()
      expect(await response.text()).not.toContain('private123')
    }
  )

  it('never echoes or logs private locators when database or session access fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.findUnique.mockRejectedValue(new Error(canonicalUrl))
      const response = await invoke()
      expect(response.status).toBe(500)
      expect(await response.text()).not.toContain('private123')
      mocks.getSession.mockRejectedValue(new Error(canonicalUrl))
      const authResponse = await invoke()
      expect(authResponse.status).toBe(500)
      expect(await authResponse.text()).not.toContain('private123')
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
})
