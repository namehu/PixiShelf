import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  countMock,
  execFileMock,
  findFirstMock,
  findUniqueMock,
  findManyMock,
  mediaVideoMetadataCountMock,
  mediaVideoMetadataCreateMock,
  mediaVideoMetadataCreateManyMock,
  mediaVideoMetadataFindManyMock,
  mediaVideoMetadataUpdateManyMock,
  mediaVideoMetadataUpdateMock,
  mediaVideoMetadataUpsertMock,
  mediaChapterPreviewUpsertMock,
  readFileMock,
  transactionMock,
  updateManyMock
} = vi.hoisted(() => ({
  countMock: vi.fn(),
  execFileMock: vi.fn(),
  findFirstMock: vi.fn(),
  findUniqueMock: vi.fn(),
  findManyMock: vi.fn(),
  mediaVideoMetadataCountMock: vi.fn(),
  mediaVideoMetadataCreateMock: vi.fn(),
  mediaVideoMetadataCreateManyMock: vi.fn(),
  mediaVideoMetadataFindManyMock: vi.fn(),
  mediaVideoMetadataUpdateManyMock: vi.fn(),
  mediaVideoMetadataUpdateMock: vi.fn(),
  mediaVideoMetadataUpsertMock: vi.fn(),
  mediaChapterPreviewUpsertMock: vi.fn(),
  readFileMock: vi.fn(),
  transactionMock: vi.fn(),
  updateManyMock: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('node:child_process', () => ({
  default: { execFile: execFileMock },
  execFile: execFileMock
}))

vi.mock('node:fs/promises', () => ({
  default: { readFile: readFileMock },
  readFile: readFileMock
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock,
    image: {
      count: countMock,
      findFirst: findFirstMock,
      findUnique: findUniqueMock,
      findMany: findManyMock,
      updateMany: updateManyMock
    },
    mediaVideoMetadata: {
      count: mediaVideoMetadataCountMock,
      create: mediaVideoMetadataCreateMock,
      createMany: mediaVideoMetadataCreateManyMock,
      findMany: mediaVideoMetadataFindManyMock,
      upsert: mediaVideoMetadataUpsertMock,
      updateMany: mediaVideoMetadataUpdateManyMock,
      update: mediaVideoMetadataUpdateMock
    },
    mediaChapterPreview: {
      upsert: mediaChapterPreviewUpsertMock
    }
  }
}))

import {
  classifyUnknownMediaImages,
  probeVideoFile,
  reprobeVideoMediaByImageId,
  resolveVideoImageForReprobePath,
  runVideoMediaProbeJob
} from '../video-media-probe-service'

describe('video-media-probe-service', () => {
  beforeEach(() => {
    countMock.mockReset().mockResolvedValue(0)
    findFirstMock.mockReset().mockResolvedValue(null)
    findUniqueMock.mockReset().mockResolvedValue(null)
    findManyMock.mockReset().mockResolvedValue([])
    updateManyMock.mockReset().mockResolvedValue({ count: 0 })
    mediaVideoMetadataCountMock.mockReset().mockResolvedValue(0)
    mediaVideoMetadataCreateMock.mockReset().mockResolvedValue({})
    mediaVideoMetadataCreateManyMock.mockReset().mockResolvedValue({ count: 0 })
    mediaVideoMetadataFindManyMock.mockReset().mockResolvedValue([])
    mediaVideoMetadataUpsertMock.mockReset().mockResolvedValue({})
    mediaVideoMetadataUpdateManyMock.mockReset().mockResolvedValue({ count: 0 })
    mediaVideoMetadataUpdateMock.mockReset().mockResolvedValue({})
    mediaChapterPreviewUpsertMock.mockReset().mockResolvedValue({})
    transactionMock.mockReset().mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations))
    readFileMock.mockReset().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
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
    execFileMock
      .mockImplementationOnce((file, args, options, callback) => {
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
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -20.0 dB' })
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

  it('uses matching companion chapters metadata to mark generated silent audio as silent', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        version: 2,
        video: 'output.mp4',
        duration: 8,
        hasAudio: false,
        chapters: [
          { index: 1, start: 0, end: 4, duration: 4 },
          { index: 2, start: 4, end: 8, duration: 4 }
        ]
      })
    )
    execFileMock
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            streams: [
              { codec_type: 'video', codec_name: 'h264', avg_frame_rate: '30/1' },
              { codec_type: 'audio', codec_name: 'aac', channels: 2, nb_read_packets: '240' }
            ],
            format: { duration: '8' }
          }),
          stderr: ''
        })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -91.0 dB' })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -inf dB' })
      })

    const result = await probeVideoFile('/scan-root/artist/work/output.mp4')

    expect(result).toMatchObject({
      hasAudio: false,
      audioCodec: null,
      audioChannels: null,
      videoCodec: 'h264',
      duration: 8,
      fps: 30,
      chapterAudio: {
        chapters: [{ hasAudibleAudio: false }, { hasAudibleAudio: false }]
      }
    })
    expect(execFileMock).toHaveBeenCalledTimes(3)
  })

  it('ignores companion chapters metadata for a different video file', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify({ video: 'other.mp4', hasAudio: false }))
    execFileMock
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            streams: [
              { codec_type: 'video', codec_name: 'h264', avg_frame_rate: '30/1' },
              { codec_type: 'audio', codec_name: 'aac', channels: 2, nb_read_packets: '240' }
            ],
            format: { duration: '8' }
          }),
          stderr: ''
        })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -91.0 dB' })
      })

    await expect(probeVideoFile('/scan-root/artist/work/output.mp4')).resolves.toMatchObject({
      hasAudio: false,
      audioCodec: null,
      audioChannels: null
    })
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('treats audio streams without packets as silent', async () => {
    execFileMock.mockImplementationOnce((file, args, options, callback) => {
      callback(null, {
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              avg_frame_rate: '30/1'
            },
            {
              codec_type: 'audio',
              codec_name: 'aac',
              channels: 2,
              nb_read_packets: '0'
            }
          ],
          format: {
            duration: '8'
          }
        }),
        stderr: ''
      })
    })

    await expect(probeVideoFile('/scan-root/artist/work/silent-track.mp4')).resolves.toEqual({
      hasAudio: false,
      audioCodec: null,
      audioChannels: null,
      videoCodec: 'h264',
      duration: 8,
      fps: 30
    })
  })

  it('keeps audio streams with packets when sampled audio is audible', async () => {
    execFileMock
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            streams: [
              { codec_type: 'video', codec_name: 'h264', avg_frame_rate: '30/1' },
              { codec_type: 'audio', codec_name: 'aac', channels: 2, nb_read_packets: '123' }
            ],
            format: { duration: '8' }
          }),
          stderr: ''
        })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -20.0 dB' })
      })

    await expect(probeVideoFile('/scan-root/artist/work/audible.mp4')).resolves.toEqual({
      hasAudio: true,
      audioCodec: 'aac',
      audioChannels: 2,
      videoCodec: 'h264',
      duration: 8,
      fps: 30
    })
  })

  it('treats long videos as silent when all sampled audio windows are silent', async () => {
    execFileMock
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            streams: [
              { codec_type: 'video', codec_name: 'h264', avg_frame_rate: '30/1' },
              { codec_type: 'audio', codec_name: 'aac', channels: 2, nb_read_packets: '3000' }
            ],
            format: { duration: '100' }
          }),
          stderr: ''
        })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -91.0 dB' })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -91.0 dB' })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -91.0 dB' })
      })

    await expect(probeVideoFile('/scan-root/artist/work/silent-long.mp4')).resolves.toMatchObject({
      hasAudio: false,
      audioCodec: null,
      audioChannels: null
    })
    expect(execFileMock).toHaveBeenCalledTimes(4)
  })

  it('stops sampling after the first audible audio window', async () => {
    execFileMock
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            streams: [
              { codec_type: 'video', codec_name: 'h264', avg_frame_rate: '30/1' },
              { codec_type: 'audio', codec_name: 'aac', channels: 2, nb_read_packets: '3000' }
            ],
            format: { duration: '100' }
          }),
          stderr: ''
        })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -20.0 dB' })
      })

    await expect(probeVideoFile('/scan-root/artist/work/audible-long.mp4')).resolves.toMatchObject({
      hasAudio: true,
      audioCodec: 'aac',
      audioChannels: 2
    })
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('fails instead of falling back to stream presence when deep audio sampling fails', async () => {
    execFileMock
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            streams: [
              { codec_type: 'video', codec_name: 'h264', avg_frame_rate: '30/1' },
              { codec_type: 'audio', codec_name: 'aac', channels: 2, nb_read_packets: '123' }
            ],
            format: { duration: '8' }
          }),
          stderr: ''
        })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(new Error('ffmpeg failed'), '', 'ffmpeg failed')
      })

    await expect(probeVideoFile('/scan-root/artist/work/probe-fallback.mp4')).rejects.toThrow('ffmpeg failed')
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

  it('queues videos that were classified when they were inserted', async () => {
    findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 9 }])

    await runVideoMediaProbeJob({ scanPath: '/scan-root' })

    expect(findManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        mediaType: 'VIDEO',
        videoMetadata: null
      },
      select: { id: true }
    })
    expect(mediaVideoMetadataCreateManyMock).toHaveBeenCalledWith({
      data: [{ imageId: 9, probeStatus: 'PENDING' }],
      skipDuplicates: true
    })
  })

  it('does not reset historical failures during a normal scheduled run', async () => {
    mediaVideoMetadataUpdateManyMock.mockResolvedValueOnce({ count: 1 })
    mediaVideoMetadataCountMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    mediaVideoMetadataFindManyMock
      .mockResolvedValueOnce([{ imageId: 1, image: { path: '/artist/work/broken.mp4' } }])
      .mockResolvedValueOnce([])
    execFileMock.mockImplementationOnce((file, args, options, callback) => {
      callback(new Error('ffprobe failed'))
    })

    const result = await runVideoMediaProbeJob({ scanPath: '/scan-root' })

    expect(mediaVideoMetadataUpdateManyMock).not.toHaveBeenCalledWith({
      where: { probeStatus: 'FAILED' },
      data: { probeStatus: 'PENDING' }
    })
    expect(mediaVideoMetadataFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ probeStatus: 'PENDING' })
      })
    )
    expect(result).toMatchObject({
      processed: 0,
      failed: 1,
      remainingPending: 0
    })
  })

  it('only resets historical failures when force is explicit', async () => {
    await runVideoMediaProbeJob({ scanPath: '/scan-root', force: true })

    expect(mediaVideoMetadataUpdateManyMock).toHaveBeenCalledWith({
      where: { probeStatus: 'FAILED' },
      data: { probeStatus: 'PENDING' }
    })
  })

  it('rechecks only rows that were marked hasAudio=true and skips media classification', async () => {
    const checkpointCreatedAt = new Date('2026-08-30T00:00:00.000Z')
    mediaVideoMetadataCountMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    mediaVideoMetadataFindManyMock
      .mockResolvedValueOnce([{ imageId: 7, image: { path: '/artist/work/silent.mp4' } }])
      .mockResolvedValueOnce([])
    execFileMock.mockImplementationOnce((file, args, options, callback) => {
      callback(null, {
        stdout: JSON.stringify({
          streams: [{ codec_type: 'video', codec_name: 'h264', avg_frame_rate: '30/1' }],
          format: { duration: '8' }
        }),
        stderr: ''
      })
    })

    const result = await runVideoMediaProbeJob({
      scanPath: '/scan-root',
      mode: 'RECHECK_HAS_AUDIO',
      force: true,
      checkpointCreatedAt
    })

    expect(findManyMock).not.toHaveBeenCalled()
    expect(mediaVideoMetadataUpdateManyMock).not.toHaveBeenCalled()
    expect(mediaVideoMetadataFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          hasAudio: true,
          OR: [
            { probeStatus: { in: ['PENDING', 'PROBING', 'FAILED'] } },
            {
              probeStatus: 'COMPLETED',
              OR: [{ probeUpdatedAt: null }, { probeUpdatedAt: { lt: checkpointCreatedAt } }]
            }
          ],
          imageId: { gt: 0 }
        }
      })
    )
    expect(result).toMatchObject({ mode: 'RECHECK_HAS_AUDIO', processed: 1, failed: 0, remainingPending: 0 })
  })

  it('requires force for the compatibility audio recalibration path', async () => {
    await expect(
      runVideoMediaProbeJob({ scanPath: '/scan-root', mode: 'RECHECK_HAS_AUDIO', force: false })
    ).rejects.toThrow('Audio recalibration must be an explicit force run')
  })

  it('persists chapter measurements without writing executor-only data to video metadata', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 12,
      path: '/artist/work/output.mp4',
      mediaType: 'VIDEO'
    })
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        version: 2,
        video: 'output.mp4',
        duration: 8,
        hasAudio: true,
        chapters: [
          { index: 1, start: 0, end: 4, duration: 4 },
          { index: 2, start: 4, end: 8, duration: 4 }
        ]
      })
    )
    execFileMock
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            streams: [
              { codec_type: 'video', codec_name: 'h264', avg_frame_rate: '30/1' },
              { codec_type: 'audio', codec_name: 'aac', channels: 2, nb_read_packets: '240' }
            ],
            format: { duration: '8' }
          }),
          stderr: ''
        })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -91.0 dB' })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -91.0 dB' })
      })

    await expect(reprobeVideoMediaByImageId(12, '/scan-root')).resolves.toMatchObject({
      hasAudio: false,
      chapterAudio: { chapters: [{ hasAudibleAudio: false }, { hasAudibleAudio: false }] }
    })

    expect(mediaChapterPreviewUpsertMock).toHaveBeenCalledTimes(2)
    expect(mediaChapterPreviewUpsertMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        update: expect.objectContaining({ hasAudibleAudio: false, audioProbeError: null })
      })
    )
    expect(mediaVideoMetadataUpdateMock).toHaveBeenLastCalledWith({
      where: { imageId: 12 },
      data: expect.not.objectContaining({ chapterAudio: expect.anything() })
    })
  })

  it('reprobes an existing video metadata row and returns flattened metadata', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 9,
      path: '/artist/work/video.mp4',
      mediaType: 'VIDEO'
    })
    execFileMock
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            streams: [
              { codec_type: 'video', codec_name: 'h264', avg_frame_rate: '30/1' },
              { codec_type: 'audio', codec_name: 'aac', channels: 2, nb_read_packets: '123' }
            ],
            format: { duration: '8' }
          }),
          stderr: ''
        })
      })
      .mockImplementationOnce((file, args, options, callback) => {
        callback(null, { stdout: '', stderr: 'max_volume: -20.0 dB' })
      })

    await expect(reprobeVideoMediaByImageId(9, '/scan-root')).resolves.toMatchObject({
      imageId: 9,
      probeStatus: 'COMPLETED',
      probeError: null,
      hasAudio: true,
      audioCodec: 'aac',
      audioChannels: 2,
      videoCodec: 'h264',
      duration: 8,
      fps: 30
    })
    expect(mediaVideoMetadataUpsertMock).toHaveBeenCalledWith({
      where: { imageId: 9 },
      create: expect.objectContaining({
        imageId: 9,
        probeStatus: 'PROBING',
        probeError: null
      }),
      update: expect.objectContaining({
        probeStatus: 'PROBING',
        probeError: null
      })
    })
    expect(mediaVideoMetadataUpdateMock).toHaveBeenCalledWith({
      where: { imageId: 9 },
      data: expect.objectContaining({
        probeStatus: 'COMPLETED',
        probeError: null,
        hasAudio: true
      })
    })
  })

  it('rejects non-video images before invoking ffprobe', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 10,
      path: '/artist/work/page.webp',
      mediaType: 'IMAGE'
    })

    await expect(reprobeVideoMediaByImageId(10, '/scan-root')).rejects.toThrow('Image is not a video')
    expect(execFileMock).not.toHaveBeenCalled()
    expect(mediaVideoMetadataUpsertMock).not.toHaveBeenCalled()
  })

  it('marks reprobe metadata as failed when ffprobe fails', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 11,
      path: '/artist/work/broken.mp4',
      mediaType: 'VIDEO'
    })
    execFileMock.mockImplementationOnce((file, args, options, callback) => {
      callback(new Error('ffprobe failed'))
    })

    await expect(reprobeVideoMediaByImageId(11, '/scan-root')).rejects.toThrow('ffprobe failed')
    expect(mediaVideoMetadataUpdateMock).toHaveBeenCalledWith({
      where: { imageId: 11 },
      data: expect.objectContaining({
        probeStatus: 'FAILED',
        probeError: 'ffprobe failed'
      })
    })
  })

  it('resolves reprobe images by relative or absolute path within scan root', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 12, path: '/artist/work/video.mp4', mediaType: 'VIDEO' })
    await expect(resolveVideoImageForReprobePath('/artist/work/video.mp4', '/scan-root')).resolves.toMatchObject({
      id: 12
    })
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        path: { in: ['/artist/work/video.mp4', 'artist/work/video.mp4'] }
      },
      orderBy: { id: 'asc' },
      select: { id: true, path: true, mediaType: true }
    })

    findFirstMock.mockResolvedValueOnce({ id: 13, path: '/artist/work/absolute.mp4', mediaType: 'VIDEO' })
    await expect(
      resolveVideoImageForReprobePath('C:\\scan-root\\artist\\work\\absolute.mp4', 'C:\\scan-root')
    ).resolves.toMatchObject({
      id: 13
    })
    expect(findFirstMock).toHaveBeenLastCalledWith({
      where: {
        path: { in: ['/artist/work/absolute.mp4', 'artist/work/absolute.mp4'] }
      },
      orderBy: { id: 'asc' },
      select: { id: true, path: true, mediaType: true }
    })
  })

  it('rejects reprobe paths that escape the scan root', async () => {
    await expect(resolveVideoImageForReprobePath('C:\\outside\\video.mp4', 'C:\\scan-root')).rejects.toThrow(
      'Path escapes scan root'
    )
    expect(findFirstMock).not.toHaveBeenCalled()
  })
})
