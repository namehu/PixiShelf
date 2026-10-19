import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { artworkExternalRef: mocks } }))
import { getArtworkSourceLinks, getArtworkSourceUrl } from '../source-links'

const source = {
  id: 'source-id',
  artworkId: 42,
  providerKey: 'e-hentai',
  externalId: '123',
  canonicalUrl: 'https://e-hentai.org/g/123/private123/',
  artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
}

describe('artwork source links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findMany.mockResolvedValue([source])
    mocks.findFirst.mockResolvedValue(source)
  })

  it('returns only a same-origin navigation link and safe identity label', async () => {
    const links = await getArtworkSourceLinks(42)
    expect(links).toEqual([{ id: 'source-id', label: 'E-Hentai #123', href: '/api/artworks/42/sources/source-id' }])
    expect(JSON.stringify(links)).not.toContain('private123')
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { artworkId: 42, artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' } }
      })
    )
  })

  it.each([
    { ...source, artworkId: 99 },
    { ...source, artwork: { deletedAt: new Date(), archiveLifecycleState: 'ACTIVE' } },
    { ...source, artwork: { deletedAt: null, archiveLifecycleState: 'TRASHED' } },
    { ...source, canonicalUrl: 'https://e-hentai.org/g/999/private123/' },
    { ...source, providerKey: 'other' },
    { ...source, canonicalUrl: 'https://evil.test/g/123/private123/' }
  ])('rejects invalid ownership, lifecycle and source identity', async (invalid) => {
    mocks.findMany.mockResolvedValue([invalid])
    mocks.findFirst.mockResolvedValue(invalid)
    expect(await getArtworkSourceLinks(42)).toEqual([])
    expect(await getArtworkSourceUrl(42, 'source-id')).toBeNull()
  })

  it('checks source ownership again at navigation time and normalizes the destination', async () => {
    mocks.findFirst.mockResolvedValue({
      ...source,
      canonicalUrl: `${source.canonicalUrl}?next=https://evil.test#token`
    })
    expect(await getArtworkSourceUrl(42, 'source-id')).toBe(source.canonicalUrl)
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'source-id', artworkId: 42, artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' } }
      })
    )
    mocks.findFirst.mockResolvedValue(null)
    expect(await getArtworkSourceUrl(42, 'source-id')).toBeNull()
  })

  it('propagates database errors to the existing page and HTTP error boundaries', async () => {
    const error = new Error(source.canonicalUrl)
    mocks.findMany.mockRejectedValue(error)
    mocks.findFirst.mockRejectedValue(error)
    await expect(getArtworkSourceLinks(42)).rejects.toBe(error)
    await expect(getArtworkSourceUrl(42, 'source-id')).rejects.toBe(error)
  })
})
