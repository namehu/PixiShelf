import { TRPCError } from '@trpc/server'
const dedupGuard = vi.hoisted(() => vi.fn())
vi.mock('../../artwork-dedup-write-guard', () => ({ assertArtworkDedupAppWrite: dedupGuard }))
const protocol = vi.hoisted(() => ({
  value: null as ReturnType<typeof createUploadProtocolMock> | null,
  failAck: false,
  recovery: vi.fn(async () => ({ status: 'READY' }))
}))
vi.mock('../content-source-guard', async (original) => {
  const { createUploadProtocolMock } = await import('./media-content-fixture')
  protocol.value = createUploadProtocolMock()
  return {
    ...(await original<typeof import('../content-source-guard')>()),
    beginContentUpload: (...args: any[]) => protocol.value!.begin(args[0]),
    finishLegacyContentGuards: vi.fn(),
    publishContentOwner: async (tx: any, _u: any, _a: any, _o: any, callback: (tx: any) => Promise<unknown>) =>
      callback(tx)
  }
})
vi.mock('@pixishelf/db', async (original) => ({
  ...(await original<typeof import('@pixishelf/db')>()),
  prepareMediaContentUploadChunk: (...args: any[]) => protocol.value!.prepare(args[0], args[1]),
  ackMediaContentUploadChunk: (...args: any[]) => {
    if (protocol.failAck) throw new Error('ack database unavailable')
    return protocol.value!.ack(args[0], args[1])
  },
  markMediaContentWriteRecoveryRequired: protocol.recovery
}))
import { fixtureAuthorization, fixtureUser, createUploadProtocolMock } from './media-content-fixture'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadMediaChapterManifest } from '../media-chapter-upload'

const { artworkFindUniqueMock, imageFindUniqueMock, associateChaptersToImageMock } = vi.hoisted(() => ({
  artworkFindUniqueMock: vi.fn(),
  imageFindUniqueMock: vi.fn(),
  associateChaptersToImageMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        image: { update: (args: any) => associateChaptersToImageMock({ imageId: args.where.id, ...args.data }) }
      }),
    artwork: {
      findUnique: artworkFindUniqueMock
    },
    image: {
      findUnique: imageFindUniqueMock
    }
  }
}))
vi.mock('../image-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../image-manager')>()
  return {
    ...actual,
    associateChaptersToImage: associateChaptersToImageMock
  }
})

describe('media-chapter-upload service', () => {
  let scanRoot: string

  beforeEach(async () => {
    scanRoot = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-media-chapter-upload-'))
    dedupGuard.mockReset().mockResolvedValue(undefined)
    protocol.failAck = false
    protocol.recovery.mockClear()
    artworkFindUniqueMock.mockReset()
    imageFindUniqueMock.mockReset()
    associateChaptersToImageMock.mockReset().mockResolvedValue({})
  })

  afterEach(async () => {
    await rm(scanRoot, { recursive: true, force: true })
  })

  it.each(['CONFLICT', 'NOT_FOUND'] as const)('rejects %s before reading the manifest or starting file work', async (code) => {
    artworkFindUniqueMock.mockResolvedValue({ id: 10, storagePath: '/artist/work', images: [] })
    dedupGuard.mockRejectedValueOnce(new TRPCError({ code }))
    const manifestText = vi.fn()
    await expect(uploadMediaChapterManifest({
      scanRoot, userId: fixtureUser, expectedUserId: fixtureUser,
      uploadSessionId: fixtureAuthorization().sessionId,
      uploadToken: '40000000-0000-4000-8000-000000000010',
      uploadRequestId: '40000000-0000-4000-8000-000000000011',
      artworkId: 10, imageId: 20, videoPath: '', manifestText
    })).rejects.toMatchObject({ status: code === 'CONFLICT' ? 409 : 404 })
    expect(manifestText).not.toHaveBeenCalled()
    expect(associateChaptersToImageMock).not.toHaveBeenCalled()
  })

  it('rechecks a late chapter association and leaves the original ready upload receipt unfinished', async () => {
    artworkFindUniqueMock.mockResolvedValue({ id: 10, storagePath: '/artist/work', images: [] })
    imageFindUniqueMock.mockResolvedValue({ id: 20, artworkId: 10, path: '/artist/work/movie.mp4' })
    dedupGuard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TRPCError({ code: 'CONFLICT' }))
    await expect(uploadMediaChapterManifest({
      scanRoot, userId: fixtureUser, expectedUserId: fixtureUser,
      uploadSessionId: fixtureAuthorization().sessionId,
      uploadToken: '40000000-0000-4000-8000-000000000010',
      uploadRequestId: '40000000-0000-4000-8000-000000000011',
      artworkId: 10, imageId: 20, videoPath: '',
      manifestText: JSON.stringify({ version: 1, duration: 20, chapters: [{ index: 1, title: 'Opening', start: 0, end: 20, duration: 20 }] })
    })).rejects.toMatchObject({ status: 409 })
    expect(dedupGuard).toHaveBeenCalledTimes(2)
    expect(associateChaptersToImageMock).not.toHaveBeenCalled()
    expect(protocol.recovery).not.toHaveBeenCalled()
  })

  it('keeps an unacknowledged chapter write in recovery without publishing its association', async () => {
    await mkdir(path.join(scanRoot, 'artist/work'), { recursive: true })
    artworkFindUniqueMock.mockResolvedValue({
      id: 10,
      externalId: 'work',
      storagePath: '/artist/work',
      images: [{ path: '/artist/work/movie.mp4' }]
    })
    imageFindUniqueMock.mockResolvedValue({ id: 20, artworkId: 10, path: '/artist/work/movie.mp4' })
    protocol.failAck = true
    await expect(
      uploadMediaChapterManifest({
        uploadSessionId: fixtureAuthorization().sessionId,
        uploadToken: '40000000-0000-4000-8000-000000000010',
        uploadRequestId: '40000000-0000-4000-8000-000000000011',
        userId: fixtureUser,
        expectedUserId: fixtureUser,
        scanRoot,
        artworkId: 10,
        imageId: 20,
        videoPath: '',
        manifestText: JSON.stringify({
          version: 1,
          duration: 20,
          chapters: [{ index: 1, title: 'Opening', start: 0, end: 20, duration: 20 }]
        })
      })
    ).rejects.toThrow('ack database unavailable')
    expect(protocol.recovery).toHaveBeenCalledOnce()
    expect(associateChaptersToImageMock).not.toHaveBeenCalled()
    await expect(readFile(path.join(scanRoot, 'artist/work/movie.chapters.json'), 'utf8')).resolves.toContain('Opening')
  })

  it('writes canonical manifest, preserves unclaimed legacy files, and associates chapters to image', async () => {
    await mkdir(path.join(scanRoot, 'artist/work'), { recursive: true })
    await writeFile(path.join(scanRoot, 'artist/work/movie.mp4.chapters.json'), '{"legacy":true}', 'utf8')
    await writeFile(path.join(scanRoot, 'artist/work/movie..chapters.json'), '{"legacy":true}', 'utf8')
    artworkFindUniqueMock.mockResolvedValue({
      id: 10,
      externalId: 'work',
      storagePath: '/artist/work',
      images: [{ path: '/artist/work/movie.mp4' }]
    })
    imageFindUniqueMock.mockResolvedValue({
      id: 20,
      artworkId: 10,
      path: '/artist/work/movie.mp4'
    })

    const result = await uploadMediaChapterManifest({
      uploadSessionId: fixtureAuthorization().sessionId,
      uploadToken: '40000000-0000-4000-8000-000000000010',
      uploadRequestId: '40000000-0000-4000-8000-000000000011',
      userId: fixtureUser,
      expectedUserId: fixtureUser,
      scanRoot,
      artworkId: 10,
      imageId: 20,
      videoPath: '',
      manifestText: JSON.stringify({
        version: 1,
        duration: 20,
        chapters: [
          { index: 1, title: 'Opening', start: 0, end: 8, duration: 8 },
          { index: 2, title: 'Ending', start: 8, end: 20, duration: 12 }
        ]
      })
    })

    expect(result).toMatchObject({
      videoFileName: 'movie.mp4',
      chaptersFileName: 'movie.chapters.json',
      chaptersPath: '/artist/work/movie.chapters.json',
      chaptersCount: 2,
      chaptersDuration: 20,
      chaptersHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    await expect(readFile(path.join(scanRoot, 'artist/work/movie.chapters.json'), 'utf8')).resolves.toContain(
      '"title": "Opening"'
    )
    await expect(readFile(path.join(scanRoot, 'artist/work/movie.mp4.chapters.json'), 'utf8')).resolves.toBe(
      '{"legacy":true}'
    )
    await expect(readFile(path.join(scanRoot, 'artist/work/movie..chapters.json'), 'utf8')).resolves.toBe(
      '{"legacy":true}'
    )
    expect(associateChaptersToImageMock).toHaveBeenCalledWith({
      imageId: 20,
      chaptersUpdatedAt: expect.any(Date),
      chaptersPath: '/artist/work/movie.chapters.json',
      chaptersCount: 2,
      chaptersDuration: 20,
      chaptersHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
  })

  it('uses explicit videoPath when imageId is absent', async () => {
    artworkFindUniqueMock.mockResolvedValue({
      id: 10,
      externalId: 'work',
      storagePath: '/artist/work',
      images: [{ path: '/artist/work/movie.mp4' }]
    })

    const result = await uploadMediaChapterManifest({
      uploadSessionId: fixtureAuthorization().sessionId,
      uploadToken: '40000000-0000-4000-8000-000000000010',
      uploadRequestId: '40000000-0000-4000-8000-000000000011',
      userId: fixtureUser,
      expectedUserId: fixtureUser,
      authorization: fixtureAuthorization(),
      scanRoot,
      artworkId: 10,
      imageId: null,
      videoPath: 'artist/work/movie.mp4',
      manifestText: JSON.stringify({
        version: 1,
        duration: 10,
        chapters: [{ index: 1, title: 'Only', start: 0, end: 10, duration: 10 }]
      })
    })

    expect(result.videoFileName).toBe('movie.mp4')
    expect(result.chaptersPath).toBe('/artist/work/movie.chapters.json')
    expect(imageFindUniqueMock).not.toHaveBeenCalled()
    expect(associateChaptersToImageMock).not.toHaveBeenCalled()
  })

  it('preserves original chapter files while replace backup is incomplete', async () => {
    const target = path.join(scanRoot, 'artist/work')
    await mkdir(path.join(target, '.bak_session'), { recursive: true })
    await writeFile(path.join(target, 'movie.chapters.json'), 'original-chapters')
    await writeFile(
      path.join(target, '.bak_session', '.session-manifest.json'),
      JSON.stringify({
        version: 1,
        originalFiles: ['movie.chapters.json'],
        phase: 'BACKING_UP'
      })
    )
    artworkFindUniqueMock.mockResolvedValue({
      id: 10,
      externalId: 'work',
      storagePath: '/artist/work',
      images: [{ path: '/artist/work/movie.mp4' }]
    })
    await expect(
      uploadMediaChapterManifest({
        uploadSessionId: fixtureAuthorization().sessionId,
        uploadToken: '40000000-0000-4000-8000-000000000010',
        uploadRequestId: '40000000-0000-4000-8000-000000000011',
        userId: fixtureUser,
        expectedUserId: fixtureUser,
        authorization: fixtureAuthorization(),
        scanRoot,
        artworkId: 10,
        imageId: null,
        videoPath: '/artist/work/movie.mp4',
        manifestText: JSON.stringify({
          version: 1,
          duration: 10,
          chapters: [{ index: 1, title: 'Only', start: 0, end: 10, duration: 10 }]
        })
      })
    ).rejects.toMatchObject({ status: 409 })
    await expect(readFile(path.join(target, 'movie.chapters.json'), 'utf8')).resolves.toBe('original-chapters')
  })

  it('rejects a non-video path with the existing message', async () => {
    artworkFindUniqueMock.mockResolvedValue({
      id: 10,
      externalId: 'work',
      storagePath: '/artist/work',
      images: [{ path: '/artist/work/cover.jpg' }]
    })

    await expect(
      uploadMediaChapterManifest({
        uploadSessionId: fixtureAuthorization().sessionId,
        uploadToken: '40000000-0000-4000-8000-000000000010',
        uploadRequestId: '40000000-0000-4000-8000-000000000011',
        userId: fixtureUser,
        expectedUserId: fixtureUser,
        authorization: fixtureAuthorization(),
        scanRoot,
        artworkId: 10,
        imageId: null,
        videoPath: '/artist/work/cover.jpg',
        manifestText: '{}'
      })
    ).rejects.toMatchObject({ status: 400, message: 'Chapter manifest can only be attached to video media' })
  })

  it('rejects videos outside the artwork media directory with the existing message', async () => {
    artworkFindUniqueMock.mockResolvedValue({
      id: 10,
      externalId: 'work',
      storagePath: '/artist/work',
      images: [{ path: '/artist/work/movie.mp4' }]
    })

    await expect(
      uploadMediaChapterManifest({
        uploadSessionId: fixtureAuthorization().sessionId,
        uploadToken: '40000000-0000-4000-8000-000000000010',
        uploadRequestId: '40000000-0000-4000-8000-000000000011',
        userId: fixtureUser,
        expectedUserId: fixtureUser,
        authorization: fixtureAuthorization(),
        scanRoot,
        artworkId: 10,
        imageId: null,
        videoPath: '/artist/other/movie.mp4',
        manifestText: '{}'
      })
    ).rejects.toMatchObject({ status: 400, message: 'Video path does not belong to artwork media directory' })
  })
})
