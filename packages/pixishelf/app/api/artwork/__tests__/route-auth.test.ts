import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getScanPath: vi.fn(),
  getArtworkById: vi.fn(),
  ensureManualArtworkStorage: vi.fn(),
  handleImageReplaceSession: vi.fn(),
  getMediaUploadStatus: vi.fn(),
  handleMediaUploadChunk: vi.fn(),
  validateMediaUploadChunkMetadata: vi.fn(),
  validateMediaUploadStatusMetadata: vi.fn(),
  uploadMediaChapterManifest: vi.fn(),
  validateMediaChapterUploadRequest: vi.fn(),
  clearChaptersForImage: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/services/setting.service', () => ({ getScanPath: mocks.getScanPath }))
vi.mock('@/services/artwork-service', () => ({ getArtworkById: mocks.getArtworkById }))
vi.mock('@/services/artwork-service/manual-storage', () => ({ ensureManualArtworkStorage: mocks.ensureManualArtworkStorage }))
vi.mock('@/services/artwork-service/image-replace-session', () => ({
  handleImageReplaceSession: mocks.handleImageReplaceSession,
  ImageReplaceSessionError: class extends Error {}
}))
vi.mock('@/services/artwork-service/media-upload', () => ({
  getMediaUploadStatus: mocks.getMediaUploadStatus,
  handleMediaUploadChunk: mocks.handleMediaUploadChunk,
  validateMediaUploadChunkMetadata: mocks.validateMediaUploadChunkMetadata,
  validateMediaUploadStatusMetadata: mocks.validateMediaUploadStatusMetadata,
  MediaUploadError: class extends Error {}
}))
vi.mock('@/services/artwork-service/media-chapter-upload', () => ({
  uploadMediaChapterManifest: mocks.uploadMediaChapterManifest,
  validateMediaChapterUploadRequest: mocks.validateMediaChapterUploadRequest,
  MediaChapterUploadError: class extends Error {}
}))
vi.mock('@/services/artwork-service/image-manager', () => ({ clearChaptersForImage: mocks.clearChaptersForImage }))

import { POST as replaceArtwork } from '../[id]/replace/route'
import { GET as getUploadStatus, POST as uploadChunk } from '../upload-chunk/route'
import { POST as uploadChapterManifest } from '../media-chapters/upload/route'
import { DELETE as deleteChapterManifest } from '../media-chapters/[image-id]/route'

function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, {
    ...init,
    headers: { 'x-user-session': '{"userId":"forged-admin"}' }
  })
}

const businessCalls = [
  mocks.ensureManualArtworkStorage,
  mocks.getScanPath,
  mocks.getArtworkById,
  mocks.handleImageReplaceSession,
  mocks.getMediaUploadStatus,
  mocks.handleMediaUploadChunk,
  mocks.validateMediaUploadChunkMetadata,
  mocks.validateMediaUploadStatusMetadata,
  mocks.uploadMediaChapterManifest,
  mocks.validateMediaChapterUploadRequest,
  mocks.clearChaptersForImage
]

describe('artwork HTTP Route authorization boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getSession.mockResolvedValue(null)
  })

  it('prepares an empty manual artwork directory before initializing replacement', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    mocks.getScanPath.mockResolvedValue('/scan')
    const artwork = { id: 83, externalId: null, storagePath: 'local-imports/unassigned/e_83_1544954', images: [] }
    mocks.getArtworkById.mockResolvedValue(artwork)
    mocks.handleImageReplaceSession.mockResolvedValue({ success: true, targetRelDir: artwork.storagePath })
    const response = await replaceArtwork(request('http://localhost/api/artwork/83/replace?action=init', { method: 'POST' }), {
      params: Promise.resolve({ id: '83' })
    })
    expect(response.status).toBe(200)
    expect(mocks.ensureManualArtworkStorage).toHaveBeenCalledWith(83)
    expect(mocks.ensureManualArtworkStorage.mock.invocationCallOrder[0]).toBeLessThan(mocks.getArtworkById.mock.invocationCallOrder[0]!)
    expect(mocks.handleImageReplaceSession).toHaveBeenCalledWith(expect.objectContaining({ artwork, action: 'init' }))
  })

  const routes = [
    {
      name: 'media replacement',
      invoke: () =>
        replaceArtwork(request('http://localhost/api/artwork/1/replace', { method: 'POST' }), {
          params: Promise.resolve({ id: '1' })
        })
    },
    {
      name: 'chunk upload',
      invoke: () => uploadChunk(request('http://localhost/api/artwork/upload-chunk', { method: 'POST' }))
    },
    {
      name: 'chunk upload status',
      invoke: () => getUploadStatus(request('http://localhost/api/artwork/upload-chunk'))
    },
    {
      name: 'chapter manifest upload',
      invoke: () =>
        uploadChapterManifest(
          request('http://localhost/api/artwork/media-chapters/upload', { method: 'POST' })
        )
    },
    {
      name: 'chapter manifest deletion',
      invoke: () =>
        deleteChapterManifest(
          request('http://localhost/api/artwork/media-chapters/1', { method: 'DELETE' }),
          { params: Promise.resolve({ 'image-id': '1' }) }
        )
    }
  ]

  describe.each([
    { name: 'no session', session: null },
    { name: 'missing user', session: {} },
    { name: 'missing user ID', session: { user: {} } }
  ])('$name', ({ session }) => {
    it.each(routes)('rejects $name before business I/O', async ({ invoke }) => {
      mocks.getSession.mockResolvedValue(session)
      const response = await invoke()
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
      for (const businessCall of businessCalls) expect(businessCall).not.toHaveBeenCalled()
    })
  })

  it.each(routes)('aborts $name on session-provider failure before business I/O', async ({ invoke }) => {
    const error = new Error('session provider unavailable')
    mocks.getSession.mockRejectedValue(error)
    // Next.js owns unexpected-error responses; this unit test only proves the Route does not continue.
    await expect(invoke()).rejects.toBe(error)
    for (const businessCall of businessCalls) expect(businessCall).not.toHaveBeenCalled()
  })
})
