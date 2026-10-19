import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), findFirst: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/lib/prisma', () => ({ prisma: { artworkExternalRef: { findFirst: mocks.findFirst } } }))
import { GET as getSource } from '../route'

const source = {
  id: 'source-id',
  artworkId: 42,
  providerKey: 'e-hentai',
  externalId: '123',
  canonicalUrl: 'https://e-hentai.org/g/123/private123/',
  artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
}
const invoke = (id = '42', sourceId = 'source-id') =>
  getSource(new Request('https://localhost/api/artworks/42/sources/source-id?url=https://evil.test'), {
    params: Promise.resolve({ id, 'source-id': sourceId })
  })

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
}

describe('artwork source navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'admin' } })
    mocks.findFirst.mockResolvedValue(source)
  })

  it.each([null, { user: {} }])('checks the session before private database access', async (session) => {
    mocks.getSession.mockResolvedValue(session)
    const response = await invoke()
    expect(response.status).toBe(401)
    expectPrivate(response)
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })

  it.each([
    ['0', 'source-id'],
    ['-1', 'source-id'],
    ['42x', 'source-id'],
    ['9007199254740992', 'source-id'],
    ['42', '../other']
  ])('rejects malformed IDs before database access', async (id, sourceId) => {
    const response = await invoke(id, sourceId)
    expect(response.status).toBe(400)
    expectPrivate(response)
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })

  it.each([
    null,
    { ...source, artworkId: 99 },
    { ...source, artwork: { deletedAt: new Date(), archiveLifecycleState: 'ACTIVE' } },
    { ...source, artwork: { deletedAt: null, archiveLifecycleState: 'TRASHED' } },
    { ...source, canonicalUrl: 'https://e-hentai.org/g/456/private123/' },
    { ...source, canonicalUrl: 'https://evil.test/g/123/private123/' }
  ])('rejects unavailable or mismatched sources with a generic error', async (invalid) => {
    mocks.findFirst.mockResolvedValue(invalid)
    const response = await invoke()
    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
    expectPrivate(response)
    expect(await response.text()).not.toContain('private123')
  })

  it('redirects only to the stored validated gallery and ignores query destinations', async () => {
    mocks.findFirst.mockResolvedValue({ ...source, canonicalUrl: `${source.canonicalUrl}?next=secret#private` })
    const response = await invoke()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(source.canonicalUrl)
    expectPrivate(response)
    expect(await response.text()).toBe('')
  })

  it('does not expose session or database exceptions', async () => {
    mocks.findFirst.mockRejectedValue(new Error(source.canonicalUrl))
    const response = await invoke()
    expect(response.status).toBe(500)
    expectPrivate(response)
    expect(await response.text()).not.toContain('private123')
    mocks.getSession.mockRejectedValue(new Error(source.canonicalUrl))
    const authResponse = await invoke()
    expect(authResponse.status).toBe(500)
    expectPrivate(authResponse)
    expect(await authResponse.text()).not.toContain('private123')
  })
})
