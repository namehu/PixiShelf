import { beforeEach, describe, expect, it, vi } from 'vitest'

const { operationOrder, metadataMock, toBufferMock, sharpMock, copyFileMock, renameMock, rmMock } = vi.hoisted(() => ({
  operationOrder: [] as string[],
  metadataMock: vi.fn(),
  toBufferMock: vi.fn(),
  sharpMock: vi.fn(),
  copyFileMock: vi.fn(),
  renameMock: vi.fn(),
  rmMock: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  copyFile: copyFileMock,
  rename: renameMock,
  rm: rmMock
}))

vi.mock('sharp', () => ({ default: sharpMock }))

import {
  buildVideoFrameExtractionArgs,
  finalizeExtractedVideoKeyframeCandidate,
  getVideoKeyframeSelectionWarning,
  parseProbedVideoDuration,
  VideoKeyframePermanentError
} from '../video-keyframe-service'

describe('video keyframe FFmpeg arguments', () => {
  beforeEach(() => {
    operationOrder.length = 0
    metadataMock.mockReset().mockImplementation(async () => {
      operationOrder.push('metadata')
      return { format: 'webp', width: 640, height: 360 }
    })
    toBufferMock.mockReset().mockImplementation(async () => {
      operationOrder.push('metrics')
      const data = Buffer.alloc(32 * 32)
      for (let index = 0; index < data.length; index += 1) data[index] = index % 2 === 0 ? 0 : 255
      return {
        data,
        info: { width: 32, height: 32 }
      }
    })
    sharpMock.mockReset().mockImplementation((filePath: string) => {
      operationOrder.push(`sharp:${filePath}`)
      return {
        metadata: metadataMock,
        resize: () => ({ grayscale: () => ({ raw: () => ({ toBuffer: toBufferMock }) }) })
      }
    })
    copyFileMock.mockReset().mockImplementation(async () => {
      operationOrder.push('copy')
    })
    renameMock.mockReset()
    rmMock.mockReset().mockImplementation(async (filePath: string) => {
      operationOrder.push(`rm:${filePath}`)
    })
  })

  it('limits decoder, filter, and encoder threads and never scales above the requested width', () => {
    const args = buildVideoFrameExtractionArgs({
      sourcePath: '/scan/video.mp4',
      outputPath: '/derived/frame.webp',
      captureTime: 12.345,
      width: 640,
      threads: 2
    })

    expect(args).toContain("scale='min(640,iw)':-2")
    expect(args.filter((value) => value === '-threads')).toHaveLength(2)
    expect(args).toContain('-filter_threads')
    expect(args[args.indexOf('-filter_threads') + 1]).toBe('2')
    expect(args.indexOf('-threads')).toBeLessThan(args.indexOf('-i'))
    expect(args.at(-1)).toBe('/derived/frame.webp')
  })

  it.each(['', 'N/A', '0', '-1'])(
    'treats a successful FFprobe result of %j as a permanent duration error',
    (stdout) => {
      expect(() => parseProbedVideoDuration(stdout)).toThrowError(VideoKeyframePermanentError)
    }
  )

  it('publishes a small usable set with a warning instead of failing the video', () => {
    expect(getVideoKeyframeSelectionWarning(2, 6, 0)).toBe('仅生成 2/6 张有效代表帧')
    expect(getVideoKeyframeSelectionWarning(2, 6, 1)).toBe('仅生成 2/6 张有效代表帧；1 个候选帧抽取失败')
  })

  it('fails only when no usable representative frame remains', () => {
    expect(() => getVideoKeyframeSelectionWarning(0, 6, 0)).toThrowError(VideoKeyframePermanentError)
    expect(() => getVideoKeyframeSelectionWarning(0, 6, 2)).toThrow('另有 2 个候选帧抽取失败')
  })

  it('validates an accepted final copy before saving its checkpoint', async () => {
    await expect(
      finalizeExtractedVideoKeyframeCandidate('/derived/frame.tmp.webp', '/derived/frame.webp')
    ).resolves.toMatchObject({ rejectionReason: null })

    expect(sharpMock).toHaveBeenNthCalledWith(1, '/derived/frame.tmp.webp')
    expect(sharpMock).toHaveBeenNthCalledWith(2, '/derived/frame.tmp.webp')
    expect(copyFileMock).toHaveBeenCalledWith('/derived/frame.tmp.webp', '/derived/frame.webp')
    expect(sharpMock).toHaveBeenNthCalledWith(3, '/derived/frame.webp')
    expect(operationOrder.indexOf('metrics')).toBeLessThan(operationOrder.indexOf('copy'))
    expect(operationOrder.indexOf('copy')).toBeLessThan(operationOrder.indexOf('sharp:/derived/frame.webp'))
    expect(rmMock).toHaveBeenCalledWith('/derived/frame.tmp.webp', { force: true })
    expect(renameMock).not.toHaveBeenCalled()
  })
})
