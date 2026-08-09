import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { countMock, findManyMock, metadataMock, sharpMock, updateManyMock } = vi.hoisted(() => ({
  countMock: vi.fn(),
  findManyMock: vi.fn(),
  metadataMock: vi.fn(),
  sharpMock: vi.fn(),
  updateManyMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    image: {
      updateMany: updateManyMock,
      count: countMock,
      findMany: findManyMock
    }
  }
}))

vi.mock('sharp', () => ({
  default: sharpMock
}))

import { EMediaAnimationStatus } from '@/enums/e-media-animation-status'
import { detectAnimatedImage, runWebpAnimationScanJob } from '../webp-animation-scan-service'

const animationPathFilters = ['.webp', '.gif', '.png', '.apng'].map((extension) => ({
  path: { endsWith: extension, mode: 'insensitive' }
}))

describe('webp-animation-scan-service', () => {
  beforeEach(() => {
    updateManyMock.mockReset().mockResolvedValue({ count: 0 })
    countMock.mockReset().mockResolvedValue(0)
    findManyMock.mockReset().mockResolvedValue([])
    metadataMock.mockReset().mockResolvedValue({ pages: 1 })
    sharpMock.mockReset().mockImplementation(() => ({ metadata: metadataMock }))
  })

  it('initializes only null animation-capable images as pending before scanning', async () => {
    findManyMock.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]).mockResolvedValueOnce([])
    updateManyMock.mockResolvedValue({ count: 3 })
    countMock.mockResolvedValue(0)

    const result = await runWebpAnimationScanJob({ scanPath: 'D:/scan-root' })

    expect(findManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        webpAnimationStatus: null,
        OR: animationPathFilters,
        id: { gt: 0 }
      },
      orderBy: { id: 'asc' },
      take: 1000,
      select: { id: true }
    })
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: [1, 2, 3] } },
      data: { webpAnimationStatus: EMediaAnimationStatus.pending }
    })
    expect(result.initialized).toBe(3)
    expect(findManyMock).toHaveBeenCalledTimes(2)
  })

  it('processes pending images in batches of 20 and corrects mediaType', async () => {
    const firstBatch = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      path: `/artist/artwork/${index + 1}.webp`
    }))
    const secondBatch = [{ id: 21, path: '/artist/artwork/21.webp' }]

    countMock.mockResolvedValueOnce(21).mockResolvedValueOnce(0)
    findManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch)
      .mockResolvedValueOnce([])
    metadataMock
      .mockResolvedValueOnce({ pages: 2 })
      .mockResolvedValueOnce({ pages: 1 })
      .mockResolvedValue({ pages: 1 })

    const result = await runWebpAnimationScanJob({ scanPath: 'D:/scan-root' })

    const [firstSharpPath, firstSharpOptions] = sharpMock.mock.calls[0] ?? []
    expect(String(firstSharpPath).replace(/\\/g, '/')).toMatch(/\/artist\/artwork\/1\.webp$/)
    expect(firstSharpOptions).toEqual({
      animated: true,
      limitInputPixels: false
    })
    expect(findManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        webpAnimationStatus: EMediaAnimationStatus.pending,
        OR: animationPathFilters,
        id: { gt: 0 }
      },
      orderBy: { id: 'asc' },
      take: 20,
      select: { id: true, path: true }
    })
    expect(findManyMock).toHaveBeenNthCalledWith(3, {
      where: {
        webpAnimationStatus: EMediaAnimationStatus.pending,
        OR: animationPathFilters,
        id: { gt: 20 }
      },
      orderBy: { id: 'asc' },
      take: 20,
      select: { id: true, path: true }
    })
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: {
        webpAnimationStatus: EMediaAnimationStatus.animated,
        mediaType: 'ANIMATION'
      }
    })
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining([2, 3, 4, 5]) } },
      data: {
        webpAnimationStatus: EMediaAnimationStatus.static,
        mediaType: 'IMAGE'
      }
    })
    expect(result).toMatchObject({
      processed: 21,
      animated: 1,
      static: 20,
      failed: 0,
      remainingPending: 0
    })
  })

  it('keeps failed images pending and reports failed samples', async () => {
    countMock.mockResolvedValueOnce(2).mockResolvedValueOnce(1)
    findManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 1, path: '/artist/artwork/static.webp' },
        { id: 2, path: '/artist/artwork/broken.webp' }
      ])
      .mockResolvedValueOnce([])
    metadataMock.mockResolvedValueOnce({ pages: 1 }).mockRejectedValueOnce(new Error('bad webp'))

    const result = await runWebpAnimationScanJob({ scanPath: 'D:/scan-root' })

    expect(updateManyMock).toHaveBeenCalledTimes(1)
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: {
        webpAnimationStatus: EMediaAnimationStatus.static,
        mediaType: 'IMAGE'
      }
    })
    expect(result).toMatchObject({
      processed: 1,
      static: 1,
      failed: 1,
      remainingPending: 1,
      failedSamples: [{ id: 2, path: '/artist/artwork/broken.webp', error: 'bad webp' }]
    })
  })

  it('uses frame count to distinguish static and animated GIF files', async () => {
    metadataMock.mockResolvedValueOnce({ pages: 1 }).mockResolvedValueOnce({ pages: 4 })

    await expect(detectAnimatedImage('D:/scan/static.gif', '/artist/static.gif')).resolves.toBe(false)
    await expect(detectAnimatedImage('D:/scan/animated.gif', '/artist/animated.gif')).resolves.toBe(true)
  })

  it('uses a valid acTL frame count to distinguish animated and single-frame APNG files', async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-apng-detect-'))
    const animatedPath = path.join(tempDirectory, 'animated.png')
    const singleFramePath = path.join(tempDirectory, 'single-frame.apng')
    const staticPngPath = path.join(tempDirectory, 'static.png')

    try {
      await fs.writeFile(animatedPath, buildApng(2))
      await fs.writeFile(singleFramePath, buildApng(1))
      await fs.writeFile(staticPngPath, buildStaticPng())

      await expect(detectAnimatedImage(animatedPath, '/artist/animated.png')).resolves.toBe(true)
      await expect(detectAnimatedImage(singleFramePath, '/artist/single-frame.apng')).resolves.toBe(false)
      await expect(detectAnimatedImage(staticPngPath, '/artist/static.png')).resolves.toBe(false)
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true })
    }
  })

  it.each([
    {
      name: 'zero frame count',
      expectedError: 'Invalid acTL num_frames: 0',
      build: () => buildPngWithControlChunk(buildApngControlData(0))
    },
    {
      name: 'invalid chunk length',
      expectedError: 'Invalid acTL chunk length: 0',
      build: () => buildPngWithControlChunk(Buffer.alloc(0))
    },
    {
      name: 'truncated chunk data',
      expectedError: 'Invalid acTL chunk data',
      build: () => buildPngWithTruncatedControlChunk()
    },
    {
      name: 'damaged chunk CRC',
      expectedError: 'Invalid acTL chunk CRC',
      build: () => buildPngWithControlChunk(buildApngControlData(2), { damageCrc: true })
    }
  ])('rejects an acTL chunk with $name', async ({ expectedError, build }) => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-invalid-apng-'))
    const filePath = path.join(tempDirectory, 'invalid.png')

    try {
      await fs.writeFile(filePath, build())
      await expect(detectAnimatedImage(filePath, '/artist/invalid.png')).rejects.toThrow(expectedError)
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true })
    }
  })
})

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function buildApng(frameCount: number) {
  const chunks = [buildPngChunk('IHDR', buildIhdrData()), buildPngChunk('acTL', buildApngControlData(frameCount))]
  let sequenceNumber = 0

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    chunks.push(buildPngChunk('fcTL', buildFrameControlData(sequenceNumber)))
    sequenceNumber += 1

    const compressedFrame = deflateSync(Buffer.from([0, 0xff, 0, 0, 0xff]))
    if (frameIndex === 0) {
      chunks.push(buildPngChunk('IDAT', compressedFrame))
    } else {
      const frameData = Buffer.alloc(4 + compressedFrame.length)
      frameData.writeUInt32BE(sequenceNumber, 0)
      compressedFrame.copy(frameData, 4)
      chunks.push(buildPngChunk('fdAT', frameData))
      sequenceNumber += 1
    }
  }

  chunks.push(buildPngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat([pngSignature, ...chunks])
}

function buildStaticPng() {
  const compressedPixel = deflateSync(Buffer.from([0, 0xff, 0, 0, 0xff]))
  return Buffer.concat([
    pngSignature,
    buildPngChunk('IHDR', buildIhdrData()),
    buildPngChunk('IDAT', compressedPixel),
    buildPngChunk('IEND', Buffer.alloc(0))
  ])
}

function buildPngWithControlChunk(data: Buffer, options?: { damageCrc?: boolean }) {
  return Buffer.concat([
    pngSignature,
    buildPngChunk('IHDR', buildIhdrData()),
    buildPngChunk('acTL', data, options),
    buildPngChunk('IEND', Buffer.alloc(0))
  ])
}

function buildPngWithTruncatedControlChunk() {
  const declaredLength = Buffer.alloc(4)
  declaredLength.writeUInt32BE(8)
  return Buffer.concat([
    pngSignature,
    buildPngChunk('IHDR', buildIhdrData()),
    declaredLength,
    Buffer.from('acTL', 'ascii'),
    Buffer.alloc(4)
  ])
}

function buildIhdrData() {
  const data = Buffer.alloc(13)
  data.writeUInt32BE(1, 0)
  data.writeUInt32BE(1, 4)
  data[8] = 8
  data[9] = 6
  return data
}

function buildApngControlData(frameCount: number) {
  const data = Buffer.alloc(8)
  data.writeUInt32BE(frameCount, 0)
  data.writeUInt32BE(0, 4)
  return data
}

function buildFrameControlData(sequenceNumber: number) {
  const data = Buffer.alloc(26)
  data.writeUInt32BE(sequenceNumber, 0)
  data.writeUInt32BE(1, 4)
  data.writeUInt32BE(1, 8)
  data.writeUInt16BE(1, 20)
  data.writeUInt16BE(10, 22)
  return data
}

function buildPngChunk(type: string, data: Buffer, options?: { damageCrc?: boolean }) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)

  const crc = Buffer.alloc(4)
  const calculatedCrc = calculatePngCrc32(Buffer.concat([typeBuffer, data]))
  crc.writeUInt32BE(options?.damageCrc ? (calculatedCrc ^ 1) >>> 0 : calculatedCrc)

  return Buffer.concat([length, typeBuffer, data, crc])
}

function calculatePngCrc32(data: Buffer): number {
  let crc = 0xffffffff

  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}
