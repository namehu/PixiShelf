import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getScanPath: vi.fn(),
  getArtworkById: vi.fn(),
  ensureManualArtworkStorage: vi.fn(),
  handleImageReplaceSession: vi.fn(),
  getMediaUploadStatus: vi.fn(),
  restartMediaUpload: vi.fn(),
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
vi.mock('@/services/artwork-service/manual-storage', () => ({
  ensureManualArtworkStorage: mocks.ensureManualArtworkStorage
}))
vi.mock('@/services/artwork-service/image-replace-session', () => ({
  handleImageReplaceSession: mocks.handleImageReplaceSession,
  ImageReplaceSessionError: class extends Error {}
}))
vi.mock('@/services/artwork-service/media-upload', () => ({
  getMediaUploadStatus: mocks.getMediaUploadStatus,
  restartMediaUpload: mocks.restartMediaUpload,
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
import { GET as getUploadStatus, POST as uploadChunk, PATCH as restartUpload } from '../upload-chunk/route'
import { POST as uploadChapterManifest } from '../media-chapters/upload/route'
import { DELETE as deleteChapterManifest } from '../media-chapters/[image-id]/route'

const protocolHeaders = {
  'x-expected-user-id': 'owner',
  'x-replace-session-id': '40000000-0000-4000-8000-000000000001',
  'x-replace-token': '40000000-0000-4000-8000-000000000002',
  'x-upload-session-id': '40000000-0000-4000-8000-000000000001',
  'x-upload-token': '40000000-0000-4000-8000-000000000002',
  'x-upload-request-id': '40000000-0000-4000-8000-000000000003'
}

function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, {
    ...init,
    headers: { ...protocolHeaders, 'x-user-session': '{"userId":"forged-admin"}', ...init?.headers }
  })
}

const businessCalls = [
  mocks.ensureManualArtworkStorage,
  mocks.getScanPath,
  mocks.getArtworkById,
  mocks.handleImageReplaceSession,
  mocks.getMediaUploadStatus,
  mocks.restartMediaUpload,
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

  it('passes the exact chapter preview confirmation from the authenticated request', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    mocks.clearChaptersForImage.mockResolvedValue({ id: 42 })
    const confirmation = {
      operationId: '50000000-0000-4000-8000-000000000001',
      selectedPaths: ['artist/work/video.chapters.json'],
      memberDigest: 'b'.repeat(64)
    }
    const response = await deleteChapterManifest(
      request('http://localhost/api/artwork/media-chapters/42', {
        method: 'DELETE',
        body: JSON.stringify({ deleteFile: true, ...confirmation }),
        headers: { 'Content-Type': 'application/json' }
      }),
      { params: Promise.resolve({ 'image-id': '42' }) }
    )
    expect(response.status).toBe(200)
    expect(mocks.clearChaptersForImage).toHaveBeenCalledWith({
      imageId: 42,
      userId: 'owner',
      deleteFile: true,
      ...confirmation
    })
  })

  it('prepares an empty manual artwork directory before initializing replacement', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    mocks.getScanPath.mockResolvedValue('/scan')
    const artwork = { id: 83, externalId: null, storagePath: 'local-imports/unassigned/e_83_1544954', images: [] }
    mocks.getArtworkById.mockResolvedValue(artwork)
    mocks.handleImageReplaceSession.mockResolvedValue({ success: true, targetRelDir: artwork.storagePath })
    const response = await replaceArtwork(
      request('http://localhost/api/artwork/83/replace?action=init', { method: 'POST' }),
      {
        params: Promise.resolve({ id: '83' })
      }
    )
    expect(response.status).toBe(200)
    expect(mocks.ensureManualArtworkStorage).toHaveBeenCalledWith(83)
    expect(mocks.ensureManualArtworkStorage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getArtworkById.mock.invocationCallOrder[0]!
    )
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
      name: 'chunk upload restart',
      invoke: () => restartUpload(request('http://localhost/api/artwork/upload-chunk', { method: 'PATCH' }))
    },
    {
      name: 'chunk upload status',
      invoke: () => getUploadStatus(request('http://localhost/api/artwork/upload-chunk'))
    },
    {
      name: 'chapter manifest upload',
      invoke: () =>
        uploadChapterManifest(request('http://localhost/api/artwork/media-chapters/upload', { method: 'POST' }))
    },
    {
      name: 'chapter manifest deletion',
      invoke: () =>
        deleteChapterManifest(request('http://localhost/api/artwork/media-chapters/1', { method: 'DELETE' }), {
          params: Promise.resolve({ 'image-id': '1' })
        })
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
    const response = await invoke()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal Server Error' })
    for (const businessCall of businessCalls) expect(businessCall).not.toHaveBeenCalled()
  })
})

describe('authenticated media failures', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    mocks.getScanPath.mockResolvedValue('/synthetic-scan-root')
    mocks.getArtworkById.mockResolvedValue({ id: 1 })
  })
  const cases = [
    {
      name: 'replacement configuration',
      fail: mocks.getScanPath,
      invoke: () =>
        replaceArtwork(request('http://localhost/api/artwork/1/replace', { method: 'POST' }), {
          params: Promise.resolve({ id: '1' })
        })
    },
    {
      name: 'replacement service',
      fail: mocks.handleImageReplaceSession,
      invoke: () =>
        replaceArtwork(request('http://localhost/api/artwork/1/replace', { method: 'POST' }), {
          params: Promise.resolve({ id: '1' })
        })
    },
    {
      name: 'chunk upload',
      fail: mocks.handleMediaUploadChunk,
      invoke: () =>
        uploadChunk(
          new NextRequest('http://localhost/api/artwork/upload-chunk', {
            method: 'POST',
            headers: { ...protocolHeaders, 'x-file-name': 'fixture.png', 'x-target-dir': 'fixture' }
          })
        )
    },
    {
      name: 'chunk status',
      fail: mocks.getMediaUploadStatus,
      invoke: () =>
        getUploadStatus(request('http://localhost/api/artwork/upload-chunk?fileName=fixture.png&targetDir=fixture'))
    },
    {
      name: 'chapter deletion',
      fail: mocks.clearChaptersForImage,
      invoke: () =>
        deleteChapterManifest(request('http://localhost/api/artwork/media-chapters/1', { method: 'DELETE' }), {
          params: Promise.resolve({ 'image-id': '1' })
        })
    },
    {
      name: 'chapter upload',
      fail: mocks.uploadMediaChapterManifest,
      invoke: () => {
        const req = request('http://localhost/api/artwork/media-chapters/upload', { method: 'POST' })
        const form = new FormData()
        form.set('artworkId', '1')
        form.set('uploadSessionId', protocolHeaders['x-upload-session-id'])
        form.set('uploadToken', protocolHeaders['x-upload-token'])
        form.set('uploadRequestId', protocolHeaders['x-upload-request-id'])
        form.set('file', new File(['{}'], 'chapters.json', { type: 'application/json' }))
        vi.spyOn(req, 'formData').mockResolvedValue(form)
        return uploadChapterManifest(req)
      }
    }
  ]
  it.each(cases)('masks unknown $name errors', async ({ fail, invoke }) => {
    fail.mockRejectedValue(new Error('Cookie: session=synthetic-one; csrf=synthetic-two'))
    const response = await invoke()
    expect(fail).toHaveBeenCalledOnce()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal Server Error' })
  })
})
