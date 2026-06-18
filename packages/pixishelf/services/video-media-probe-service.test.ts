import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  countMock,
  execFileMock,
  findManyMock,
  mediaVideoMetadataCountMock,
  mediaVideoMetadataCreateManyMock,
  mediaVideoMetadataFindManyMock,
  mediaVideoMetadataUpdateManyMock,
  mediaVideoMetadataUpdateMock,
  updateManyMock
} = vi.hoisted(() => ({
  countMock: vi.fn(),
  execFileMock: vi.fn(),
  findManyMock: vi.fn(),
  mediaVideoMetadataCountMock: vi.fn(),
  mediaVideoMetadataCreateManyMock: vi.fn(),
  mediaVideoMetadataFindManyMock: vi.fn(),
  mediaVideoMetadataUpdateManyMock: vi.fn(),
  mediaVideoMetadataUpdateMock: vi.fn(),
  updateManyMock: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    image: {
      count: countMock,
      findMany: findManyMock,
      updateMany: updateManyMock
    },
    mediaVideoMetadata: {
      count: mediaVideoMetadataCountMock,
      createMany: mediaVideoMetadataCreateManyMock,
      findMany: mediaVideoMetadataFindManyMock,
      updateMany: mediaVideoMetadataUpdateManyMock,
      update: mediaVideoMetadataUpdateMock
    }
  }
}))

import { classifyUnknownMediaImages, probeVideoFile, runVideoMediaProbeJob } from './video-media-probe-service'

describe('video-media-probe-service', () => {
  beforeEach(() => {
    countMock.mockReset().mockResolvedValue(0)
    findManyMock.mockReset().mockResolvedValue([])
    updateManyMock.mockReset().mockResolvedValue({ count: 0 })
    mediaVideoMetadataCountMock.mockReset().mockResolvedValue(0)
    mediaVideoMetadataCreateManyMock.mockReset().mockResolvedValue({ count: 0 })
    mediaVideoMetadataFindManyMock.mockReset().mockResolvedValue([])
    mediaVideoMetadataUpdateManyMock.mockReset().mockResolvedValue({ count: 0 })
    mediaVideoMetadataUpdateMock.mockReset().mockResolvedValue({})
    execFileMock.mockReset().mockImplementation((file, args, options, callback) => {
      callback(null, { stdout: '{}', stderr: '' })
    })
  })

  it('classifies unknown images and creates pending metadata rows for videos', async () => {
    mediaVideoMetadataCreateManyMock.mockResolvedValueOnce({ count: 1 })
    findManyMock.mockResolvedValueOnce([
      { id: 1, path: '/artist/work/video.mp4' },
      { id: 2, path: '/artist/work/page.webp' },
      { id: 3, path: '/artist/work/anim.gif' },
      { id: 4, path: '/artist/work/archive.bin' }
    ])

    const result = await classifyUnknownMediaImages()

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: { mediaType: 'VIDEO' }
    })
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: [2] } },
      data: { mediaType: 'IMAGE' }
    })
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: [3] } },
      data: { mediaType: 'ANIMATION' }
    })
    expect(mediaVideoMetadataCreateManyMock).toHaveBeenCalledWith({
      data: [{ imageId: 1, probeStatus: 'PENDING' }],
      skipDuplicates: true
    })
    expect(result).toEqual({
      classifiedVideos: 1,
      classifiedImages: 1,
      classifiedAnimations: 1,
      unknown: 1,
      metadataRowsCreated: 1
    })
  })

  it('parses ffprobe output into flattened video metadata', async () => {
    execFileMock.mockImplementationOnce((file, args, options, callback) => {
      callback(null, {
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              avg_frame_rate: '30000/1001'
            },
            {
              codec_type: 'audio',
              codec_name: 'aac',
              channels: 2
            }
          ],
          format: {
            duration: '12.5'
          }
        }),
        stderr: ''
      })
    })

    await expect(probeVideoFile('/scan-root/artist/work/video.mp4')).resolves.toEqual({
      hasAudio: true,
      audioCodec: 'aac',
      audioChannels: 2,
      videoCodec: 'h264',
      duration: 12.5,
      fps: 29.97002997002997
    })
  })

  it('continues after per-file probe failures and records failed samples', async () => {
    mediaVideoMetadataCountMock.mockResolvedValueOnce(2).mockResolvedValueOnce(1)
    mediaVideoMetadataFindManyMock.mockResolvedValueOnce([
      { imageId: 1, image: { path: '/artist/work/ok.mp4' } },
      { imageId: 2, image: { path: '/artist/work/broken.mp4' } }
    ])
    execFileMock
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            streams: [{ codec_type: 'video', codec_name: 'vp9', avg_frame_rate: '24/1' }],
            format: { duration: '4' }
          }),
          stderr: ''
        })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(new Error('ffprobe failed'))
      })

    const result = await runVideoMediaProbeJob({ scanPath: '/scan-root' })

    expect(mediaVideoMetadataUpdateMock).toHaveBeenCalledWith({
      where: { imageId: 1 },
      data: expect.objectContaining({
        probeStatus: 'COMPLETED',
        hasAudio: false,
        videoCodec: 'vp9',
        duration: 4,
        fps: 24,
        probeError: null
      })
    })
    expect(mediaVideoMetadataUpdateMock).toHaveBeenCalledWith({
      where: { imageId: 2 },
      data: expect.objectContaining({
        probeStatus: 'FAILED',
        probeError: 'ffprobe failed'
      })
    })
    expect(result).toMatchObject({
      processed: 1,
      failed: 1,
      failedSamples: [{ imageId: 2, path: '/artist/work/broken.mp4', error: 'ffprobe failed' }]
    })
  })

  it('reports classification progress and video probe totals', async () => {
    countMock.mockResolvedValueOnce(2)
    mediaVideoMetadataCreateManyMock.mockResolvedValueOnce({ count: 1 })
    findManyMock
      .mockResolvedValueOnce([
        { id: 1, path: '/artist/work/video.mp4' },
        { id: 2, path: '/artist/work/page.webp' }
      ])
      .mockResolvedValueOnce([])
    mediaVideoMetadataCountMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    mediaVideoMetadataFindManyMock.mockResolvedValueOnce([{ imageId: 1, image: { path: '/artist/work/video.mp4' } }])
    execFileMock.mockImplementationOnce((file, args, options, callback) => {
      callback(null, {
        stdout: JSON.stringify({
          streams: [{ codec_type: 'video', codec_name: 'h264', avg_frame_rate: '30/1' }],
          format: { duration: '10' }
        }),
        stderr: ''
      })
    })
    const progress: Array<{ percentage: number; message: string }> = []

    await runVideoMediaProbeJob({
      scanPath: '/scan-root',
      onProgress: (item) => {
        progress.push(item)
      }
    })

    expect(progress.some((item) => item.message.includes('分类媒体 2/2'))).toBe(true)
    expect(progress.some((item) => item.message.includes('已探测 1/1'))).toBe(true)
  })

  it('does not reselect failures produced during the same run', async () => {
    mediaVideoMetadataUpdateManyMock.mockResolvedValueOnce({ count: 1 })
    mediaVideoMetadataCountMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    mediaVideoMetadataFindManyMock
      .mockResolvedValueOnce([{ imageId: 1, image: { path: '/artist/work/broken.mp4' } }])
      .mockResolvedValueOnce([])
    execFileMock.mockImplementationOnce((file, args, options, callback) => {
      callback(new Error('ffprobe failed'))
    })

    const result = await runVideoMediaProbeJob({ scanPath: '/scan-root' })

    expect(mediaVideoMetadataUpdateManyMock).toHaveBeenCalledWith({
      where: { probeStatus: 'FAILED' },
      data: { probeStatus: 'PENDING' }
    })
    expect(mediaVideoMetadataFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { probeStatus: 'PENDING' }
      })
    )
    expect(result).toMatchObject({
      processed: 0,
      failed: 1,
      remainingPending: 0
    })
  })
})
