// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const mocks = vi.hoisted(() => ({ image: vi.fn(), claim: vi.fn(), root: vi.fn(), cover: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { image: { findUnique: mocks.image }, artworkDedupClaim: { findUnique: mocks.claim } }
}))
vi.mock('@/lib/mobile/auth', () => ({ getMobileSession: vi.fn() }))
vi.mock('@/services/setting.service', () => ({ getScanPath: mocks.root }))
vi.mock('@/services/archive/config', () => ({ requireArchiveStorageRoot: mocks.root }))
vi.mock('@/services/artwork-dedup-cover', () => ({ openArtworkDedupCover: mocks.cover }))
import { openMobileMedia } from '@/services/mobile-media-service'
let directory: string
const record = {
  artworkId: 4,
  path: 'sample.mp4',
  mediaType: 'VIDEO',
  artwork: { mediaRevision: 2, createdVia: 'LOCAL_IMPORT', deletedAt: null, archiveLifecycleState: 'ACTIVE' }
}
beforeEach(async () => {
  vi.resetAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'pixishelf-mobile-media-'))
  await writeFile(join(directory, 'sample.mp4'), Buffer.from('0123456789'))
  mocks.root.mockResolvedValue(directory)
  mocks.image.mockResolvedValue(record)
  mocks.claim.mockResolvedValue(null)
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
it('streams only requested video bytes without public cache headers', async () => {
  const response = await openMobileMedia(8, 2, 'original', 'bytes=3-6')
  expect(response.status).toBe(206)
  expect(response.headers.get('content-range')).toBe('bytes 3-6/10')
  expect(await response.text()).toBe('3456')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})
it('serves complete originals and suffix ranges', async () => {
  expect(await (await openMobileMedia(8, 2, 'original')).text()).toBe('0123456789')
  expect(await (await openMobileMedia(8, 2, 'original', 'bytes=-3')).text()).toBe('789')
  expect((await openMobileMedia(8, 2, 'original', 'bytes=100-')).status).toBe(416)
})
it('rejects stale revisions and maintenance copies before filesystem access', async () => {
  await expect(openMobileMedia(8, 1, 'original')).rejects.toMatchObject({ status: 409 })
  mocks.claim.mockResolvedValue({ role: 'COPY' })
  await expect(openMobileMedia(8, 2, 'original')).rejects.toMatchObject({ status: 404 })
  expect(mocks.root).not.toHaveBeenCalled()
})
it('rejects hidden, traversal and symlink escape sources', async () => {
  for (const path of ['../outside.mp4', '.recovery/secret.mp4', '/absolute.mp4']) {
    mocks.image.mockResolvedValue({ ...record, path })
    await expect(openMobileMedia(8, 2, 'original')).rejects.toMatchObject({ status: 404 })
  }
  await symlink('/etc/passwd', join(directory, 'escape.mp4'))
  mocks.image.mockResolvedValue({ ...record, path: 'escape.mp4' })
  await expect(openMobileMedia(8, 2, 'original')).rejects.toMatchObject({ status: 404 })
})
it('never reads removed or orphaned media', async () => {
  mocks.image.mockResolvedValue({ ...record, artwork: { ...record.artwork, deletedAt: new Date() } })
  await expect(openMobileMedia(8, 2, 'original')).rejects.toMatchObject({ status: 404 })
  mocks.image.mockResolvedValue({ ...record, artwork: null })
  await expect(openMobileMedia(8, 2, 'original')).rejects.toMatchObject({ status: 404 })
})

it('streams APNG originals intact instead of flattening them into a preview', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 97, 99, 84, 76])
  await writeFile(join(directory, 'sample.apng'), png)
  mocks.image.mockResolvedValue({ ...record, path: 'sample.apng', mediaType: 'ANIMATION' })
  const response = await openMobileMedia(8, 2, 'original')
  expect(response.headers.get('content-type')).toBe('image/apng')
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
  expect(mocks.cover).not.toHaveBeenCalled()
})

it('creates bounded static thumbnails while keeping original bytes and revision protection', async () => {
  const sharp = (await import('sharp')).default
  const original = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#006fbe' } }).png().toBuffer()
  mocks.cover.mockImplementation(async () => ({ size: original.length, body: new Response(new Uint8Array(original)).body! }))
  const response = await openMobileMedia(8, 2, 'thumbnail')
  const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
  expect(meta.width).toBe(512)
  expect(meta.height).toBe(256)
  expect(meta.format).toBe('webp')
  expect(response.headers.get('vary')).toBe('Authorization')
  expect(mocks.cover).toHaveBeenCalledWith(4, 8)
  await expect(openMobileMedia(8, 1, 'thumbnail')).rejects.toMatchObject({ status: 409 })
})
