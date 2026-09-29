import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  getScanPath: vi.fn(),
  getArtworkById: vi.fn(),
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
vi.mock('@/services/background-task/request-auth', () => ({ requireAdminRequest: mocks.requireAdminRequest }))
vi.mock('@/services/setting.service', () => ({ getScanPath: mocks.getScanPath }))
vi.mock('@/services/artwork-service', () => ({ getArtworkById: mocks.getArtworkById }))
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

const businessCalls = [
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
    vi.clearAllMocks()
    mocks.requireAdminRequest.mockRejectedValue(new ApiError('Unauthorized', 401))
  })

  it.each([
    {
      name: 'media replacement',
      invoke: () =>
        replaceArtwork(new NextRequest('http://localhost/api/artwork/1/replace', { method: 'POST' }), {
          params: Promise.resolve({ id: '1' })
        })
    },
    {
      name: 'chunk upload',
      invoke: () => uploadChunk(new NextRequest('http://localhost/api/artwork/upload-chunk', { method: 'POST' }))
    },
    {
      name: 'chunk upload status',
      invoke: () => getUploadStatus(new NextRequest('http://localhost/api/artwork/upload-chunk'))
    },
    {
      name: 'chapter manifest upload',
      invoke: () =>
        uploadChapterManifest(
          new NextRequest('http://localhost/api/artwork/media-chapters/upload', { method: 'POST' })
        )
    },
    {
      name: 'chapter manifest deletion',
      invoke: () =>
        deleteChapterManifest(
          new NextRequest('http://localhost/api/artwork/media-chapters/1', { method: 'DELETE' }),
          { params: Promise.resolve({ 'image-id': '1' }) }
        )
    }
  ])('rejects unauthenticated $name before business I/O', async ({ invoke }) => {
    const response = await invoke()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.requireAdminRequest).toHaveBeenCalledTimes(1)
    for (const businessCall of businessCalls) expect(businessCall).not.toHaveBeenCalled()
  })
})
