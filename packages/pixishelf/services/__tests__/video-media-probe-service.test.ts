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
  readFileMock,
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
  readFileMock: vi.fn(),
  updateManyMock: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock
}))

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
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
    readFileMock.mockResolvedValueOnce(JSON.stringify({ video: 'output.mp4', hasAudio: false }))
    execFileMock.mockImplementationOnce((file, args, options, callback) => {
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

    await expect(probeVideoFile('/scan-root/artist/work/output.mp4')).resolves.toEqual({
      hasAudio: false,
      audioCodec: null,
      audioChannels: null,
      videoCodec: 'h264',
      duration: 8,
      fps: 30
    })
    expect(execFileMock).toHaveBeenCalledTimes(1)
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

  it('falls back to ffprobe audio metadata when deep audio sampling fails', async () => {
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

    await expect(probeVideoFile('/scan-root/artist/work/probe-fallback.mp4')).resolves.toMatchObject({
      hasAudio: true,
      audioCodec: 'aac',
      audioChannels: 2
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
    await expect(resolveVideoImageForReprobePath('C:\\scan-root\\artist\\work\\absolute.mp4', 'C:\\scan-root')).resolves.toMatchObject({
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
