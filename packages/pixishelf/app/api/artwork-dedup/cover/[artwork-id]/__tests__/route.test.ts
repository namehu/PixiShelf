// @vitest-environment node
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  artwork: vi.fn(),
  claim: vi.fn(),
  root: vi.fn(),
  posterRoot: `/tmp/dedup-cover-poster-${process.pid}`
}))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@/lib/prisma', () => ({
  prisma: { artwork: { findUnique: mocks.artwork }, artworkDedupClaim: { findUnique: mocks.claim } }
}))
vi.mock('@/services/setting.service', () => ({ getScanPath: mocks.root }))
vi.mock('@/services/archive/config', () => ({ requireArchiveStorageRoot: mocks.root }))
vi.mock('@/services/derived-media-storage-paths', () => ({
  VIDEO_POSTER_STORAGE_ROOT: mocks.posterRoot,
  resolveDerivedMediaStoragePath: (root: string, relative: string) => `${root}/${relative}`
}))
import { GET as getCover } from '../route'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfZkAAAAASUVORK5CYII=',
  'base64'
)
let root: string
function artwork(file = 'cover.png') {
  return {
    deletedAt: null,
    archiveLifecycleState: 'ACTIVE',
    createdVia: 'LOCAL_DIRECTORY',
    images: [{ path: file, mediaType: 'IMAGE', videoMetadata: null }]
  }
}
const request = (actor = 'actor', id = '1') =>
  getCover(new Request(`http://localhost/api/artwork-dedup/cover/${id}?expectedUserId=${actor}`), {
    params: Promise.resolve({ 'artwork-id': id })
  })
describe('authenticated artwork-ID cover route', () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dedup-cover-'))
    await writeFile(path.join(root, 'cover.png'), png)
    await mkdir(path.join(root, '.hidden'))
    await writeFile(path.join(root, '.hidden', 'secret.png'), png)
    await symlink(path.join(root, '.hidden', 'secret.png'), path.join(root, 'alias.png'))
    await mkdir(mocks.posterRoot, { recursive: true })
    await writeFile(path.join(mocks.posterRoot, 'poster.png'), png)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'actor' } })
    mocks.artwork.mockResolvedValue(artwork())
    mocks.claim.mockResolvedValue(null)
    mocks.root.mockResolvedValue(root)
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(mocks.posterRoot, { recursive: true, force: true })
  })
  it('rejects anonymous and switched accounts before querying private media', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await request()).status).toBe(401)
    mocks.session.mockResolvedValue({ user: { id: 'other' } })
    expect((await request()).status).toBe(403)
    expect(mocks.artwork).not.toHaveBeenCalled()
  })
  it.each([null, { ...artwork(), deletedAt: new Date() }, { ...artwork(), archiveLifecycleState: 'TRASHED' }])(
    'hides unavailable artwork %#',
    async (value) => {
      mocks.artwork.mockResolvedValue(value)
      const response = await request()
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(mocks.root).not.toHaveBeenCalled()
    }
  )
  it('hides claimed copies and rejects invalid IDs', async () => {
    mocks.claim.mockResolvedValue({ role: 'COPY' })
    expect((await request()).status).toBe(404)
    expect((await request('actor', '../1')).status).toBe(400)
    expect(mocks.root).not.toHaveBeenCalled()
  })
  it.each(['.hidden/secret.png', 'alias.png', '../outside.png'])(
    'rejects hidden or escaped path %s without exposing it',
    async (file) => {
      mocks.artwork.mockResolvedValue(artwork(file))
      const response = await request()
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain(file)
    }
  )
  it('streams a valid registered image with account-private cache headers and no redirect', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
    expect(response.headers.get('location')).toBeNull()
    expect(mocks.artwork.mock.calls[0]?.[0]).toMatchObject({ where: { id: 1 }, select: { images: { take: 1 } } })
  })
  it('uses an existing completed video poster and never sends the original video', async () => {
    mocks.artwork.mockResolvedValue({
      ...artwork(),
      images: [
        {
          path: 'private-video.mp4',
          mediaType: 'VIDEO',
          videoMetadata: { posterStatus: 'COMPLETED', posterPath: 'poster.png' }
        }
      ]
    })
    expect(Buffer.from(await (await request()).arrayBuffer())).toEqual(png)
    expect(mocks.root).not.toHaveBeenCalled()
  })
})
