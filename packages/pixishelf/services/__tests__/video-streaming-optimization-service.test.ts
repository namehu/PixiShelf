import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

const { execFileMock, spawnMock, imageFindUniqueMock, imageUpdateMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
  imageFindUniqueMock: vi.fn(),
  imageUpdateMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('node:child_process', () => ({ execFile: execFileMock, spawn: spawnMock }))
vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    image: {
      findUnique: imageFindUniqueMock,
      update: imageUpdateMock
    }
  }
}))

import { optimizeVideoForStreaming } from '../video-streaming-optimization-service'

const probeOutput = JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
    { codec_type: 'audio', codec_name: 'aac', channels: 2 }
  ],
  format: { duration: '120.000' }
})

describe('video streaming optimization service', () => {
  let scanPath: string
  let sourcePath: string

  beforeEach(async () => {
    scanPath = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-remux-'))
    sourcePath = path.join(scanPath, 'video.mp4')
    await writeFile(sourcePath, 'original-video')

    imageFindUniqueMock.mockReset().mockResolvedValue({ id: 7, path: '/video.mp4', mediaType: 'UNKNOWN' })
    imageUpdateMock.mockReset().mockResolvedValue({ id: 7 })
    execFileMock.mockReset().mockImplementation((command, _args, _options, callback) => {
      const child = { kill: vi.fn(() => true) }
      if (command === 'ffprobe') {
        callback(null, probeOutput, '')
        return child
      }
      return child
    })
    spawnMock.mockReset().mockImplementation((_command, args) =>
      createSpawnProcess(async (child) => {
        const outputPath = args.at(-1)
        await writeFile(outputPath, 'optimized-video')
        child.stdout.write('out_time=00:01:00.000000\nprogress=continue\n')
        child.emit('close', 0)
      })
    )
  })

  afterEach(async () => {
    await rm(scanPath, { recursive: true, force: true })
  })

  it('remuxes a legacy UNKNOWN MP4 and replaces it without changing its database path', async () => {
    const progress: number[] = []
    const result = await optimizeVideoForStreaming({
      imageId: 7,
      scanPath,
      onProgress: ({ percentage }) => {
        progress.push(percentage)
      }
    })

    expect(await readFile(sourcePath, 'utf8')).toBe('optimized-video')
    expect(spawnMock).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-c', 'copy', '-movflags', '+faststart', '-progress', 'pipe:1']),
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    expect(imageUpdateMock).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { size: BigInt(Buffer.byteLength('optimized-video')) }
    })
    expect(result).toMatchObject({ imageId: 7, path: '/video.mp4', duration: 120 })
    expect(progress).toEqual([2, 8, 15, 48, 82, 92, 100])
    expect((await readdir(scanPath)).filter((name) => name.includes('.pixishelf-remux-'))).toEqual([])
  })

  it('keeps the original file and cleans temporary output when FFmpeg fails', async () => {
    spawnMock.mockImplementation(() =>
      createSpawnProcess(async (child) => {
        child.stderr.write('invalid input')
        child.emit('close', 1)
      })
    )

    await expect(optimizeVideoForStreaming({ imageId: 7, scanPath })).rejects.toThrow('invalid input')
    expect(await readFile(sourcePath, 'utf8')).toBe('original-video')
    expect((await readdir(scanPath)).filter((name) => name.includes('.pixishelf-remux-'))).toEqual([])
    expect(imageUpdateMock).not.toHaveBeenCalled()
  })

  it('does not overwrite the source when it changes during FFmpeg processing', async () => {
    spawnMock.mockImplementation((_command, args) =>
      createSpawnProcess(async (child) => {
        const outputPath = args.at(-1)
        await Promise.all([
          writeFile(outputPath, 'optimized-video'),
          writeFile(sourcePath, 'externally-modified-video')
        ])
        child.emit('close', 0)
      })
    )

    await expect(optimizeVideoForStreaming({ imageId: 7, scanPath })).rejects.toThrow(
      'Source video changed while FFmpeg was running'
    )
    expect(await readFile(sourcePath, 'utf8')).toBe('externally-modified-video')
    expect((await readdir(scanPath)).filter((name) => name.includes('.pixishelf-remux-'))).toEqual([])
    expect(imageUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects non-MP4 media before invoking FFmpeg', async () => {
    const mkvPath = path.join(scanPath, 'video.mkv')
    await writeFile(mkvPath, 'mkv')
    imageFindUniqueMock.mockResolvedValue({ id: 8, path: '/video.mkv', mediaType: 'VIDEO' })

    await expect(optimizeVideoForStreaming({ imageId: 8, scanPath })).rejects.toThrow(
      'Only MP4 videos can be optimized'
    )
    expect(execFileMock).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

function createSpawnProcess(run: (child: any) => Promise<void>) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn(() => true)
  queueMicrotask(() => {
    void run(child).catch((error) => child.emit('error', error))
  })
  return child
}
