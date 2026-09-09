import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { archiveImport: { findUnique: mocks.findUnique } } }))
import { archiveTaskSourceUrl, getArchiveTaskSourceUrl } from '../archive-task-source-service'

const task = { providerKey: 'e-hentai', externalId: '123', canonicalUrl: 'https://e-hentai.org/g/123/abc123/' }

describe('archive task source navigation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the frozen gallery version and strips query and fragment', () => {
    expect(
      archiveTaskSourceUrl({ ...task, canonicalUrl: `${task.canonicalUrl}?next=https://evil.test/#private` })
    ).toBe(task.canonicalUrl)
  })

  it.each([
    'http://e-hentai.org/g/123/abc123/',
    'https://e-hentai.org.evil.test/g/123/abc123/',
    'https://user:secret@e-hentai.org/g/123/abc123/',
    'https://e-hentai.org:8443/g/123/abc123/',
    'https://e-hentai.org/s/abc123/123-1',
    'https://e-hentai.org/g/456/abc123/',
    'https://e-hentai.org/g/123/abc123/extra',
    'https://e-hentai.org/g/123/%0d%0a/',
    'javascript:alert(1)',
    '//evil.test',
    'invalid'
  ])('rejects an unsafe or mismatched canonical URL: %s', (canonicalUrl) => {
    expect(archiveTaskSourceUrl({ ...task, canonicalUrl })).toBeNull()
  })

  it('rejects an unsupported provider even with a valid gallery URL', () => {
    expect(archiveTaskSourceUrl({ ...task, providerKey: 'pixiv' })).toBeNull()
  })

  it('reads only the task locator, never a submitted image page or a newer gallery', async () => {
    mocks.findUnique.mockResolvedValue(task)
    expect(await getArchiveTaskSourceUrl('archive-id')).toBe(task.canonicalUrl)
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: 'archive-id' },
      select: { providerKey: true, externalId: true, canonicalUrl: true }
    })
    mocks.findUnique.mockResolvedValue(null)
    expect(await getArchiveTaskSourceUrl('missing')).toBeNull()
  })
})
