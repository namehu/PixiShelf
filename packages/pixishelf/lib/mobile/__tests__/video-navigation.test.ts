// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const mocks = vi.hoisted(() => ({ image: vi.fn(), claim: vi.fn(), scan: vi.fn(), archive: vi.fn(), keyframes: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { image: { findUnique: mocks.image }, artworkDedupClaim: { findUnique: mocks.claim } } }))
vi.mock('@/lib/mobile/auth', () => ({ getMobileSession: vi.fn() }))
vi.mock('@/services/setting.service', () => ({ getScanPath: mocks.scan }))
vi.mock('@/services/archive/config', () => ({ requireArchiveStorageRoot: mocks.archive }))
vi.mock('@/services/video-keyframe-read-service', () => ({ getPlayableVideoKeyframesByImageId: mocks.keyframes }))
import { mobileVideoNavigation } from '@/services/mobile-video-navigation-service'

let root: string
const image = () => ({ artworkId: 4, path: 'movie.mp4', mediaType: 'VIDEO', chaptersPath: '/movie.chapters.json',
  artwork: { mediaRevision: 3, createdVia: 'SCAN', deletedAt: null, archiveLifecycleState: 'ACTIVE' } })
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-navigation-'))
  await writeFile(path.join(root, 'movie.mp4'), 'video-fixture')
  await mkdir(path.join(root, '.private'))
  await writeFile(path.join(root, '.private', 'chapters.json'), '{}')
  await symlink(path.join(root, '.private', 'chapters.json'), path.join(root, 'hidden-alias.json'))
})
afterAll(async () => { await rm(root, { recursive: true, force: true }) })
beforeEach(async () => {
  vi.resetAllMocks()
  mocks.image.mockResolvedValue(image())
  mocks.scan.mockResolvedValue(root)
  mocks.archive.mockResolvedValue(root)
  mocks.claim.mockResolvedValue(null)
  mocks.keyframes.mockResolvedValue({ frames: [{ id: 'frame-1', captureTime: 3.5, selectedOrder: 1, url: '/derived/private-path' }] })
  await writeFile(path.join(root, 'movie.chapters.json'), JSON.stringify({ version: 1, duration: 10, video: '/private/video',
    outputPath: '/private/output', chapters: [{ index: 1, title: 'Opening', start: 0, end: 10, duration: 10, file: '/private/source', source: { token: 'private' } }] }))
})
it('returns only current navigation timestamps without derived/source paths or manifest diagnostics', async () => {
  expect(await mobileVideoNavigation(8, 3)).toEqual({ chapters: [{ index: 1, title: 'Opening', start: 0, end: 10 }],
    frames: [{ id: 'frame-1', captureTime: 3.5, selectedOrder: 1 }] })
  expect(mocks.keyframes).toHaveBeenCalledWith(8)
})
it('rejects deleted, non-active and stale media before reading manifests', async () => {
  for (const artwork of [{ ...image().artwork, deletedAt: new Date() }, { ...image().artwork, archiveLifecycleState: 'TRASHED' }]) {
    mocks.image.mockResolvedValue({ ...image(), artwork })
    await expect(mobileVideoNavigation(8, 3)).rejects.toMatchObject({ status: 404 })
  }
  mocks.image.mockResolvedValue(image())
  await expect(mobileVideoNavigation(8, 2)).rejects.toMatchObject({ status: 409 })
  expect(mocks.keyframes).not.toHaveBeenCalled()
})
it('rejects maintenance copies, non-video files and hidden paths', async () => {
  mocks.claim.mockResolvedValue({ role: 'COPY' })
  await expect(mobileVideoNavigation(8, 3)).rejects.toMatchObject({ status: 404 })
  mocks.claim.mockResolvedValue(null)
  mocks.image.mockResolvedValue({ ...image(), path: 'image.png', mediaType: 'IMAGE' })
  await expect(mobileVideoNavigation(8, 3)).rejects.toMatchObject({ status: 400 })
  for (const chaptersPath of ['/.private/chapters.json', 'hidden-alias.json', '../outside.json']) {
    mocks.image.mockResolvedValue({ ...image(), chaptersPath })
    await expect(mobileVideoNavigation(8, 3)).rejects.toMatchObject({ status: 404 })
  }
})
it('bounds chapter manifests and tolerates absent optional navigation data', async () => {
  await writeFile(path.join(root, 'movie.chapters.json'), ' '.repeat(5 * 1024 * 1024 + 1))
  await expect(mobileVideoNavigation(8, 3)).rejects.toMatchObject({ status: 413 })
  mocks.image.mockResolvedValue({ ...image(), chaptersPath: 'missing.chapters.json' })
  mocks.keyframes.mockResolvedValue(null)
  expect(await mobileVideoNavigation(8, 3)).toEqual({ chapters: [], frames: [] })
})
it('uses the registered archive root for archived video chapter data', async () => {
  mocks.image.mockResolvedValue({ ...image(), artwork: { ...image().artwork, createdVia: 'URL_ARCHIVE' } })
  await mobileVideoNavigation(8, 3)
  expect(mocks.archive).toHaveBeenCalledOnce()
  expect(mocks.scan).not.toHaveBeenCalled()
})
