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

import { detectAnimatedImage } from '../webp-animation-scan-service'

describe('webp-animation-scan-service', () => {
  beforeEach(() => {
    updateManyMock.mockReset().mockResolvedValue({ count: 0 })
    countMock.mockReset().mockResolvedValue(0)
    findManyMock.mockReset().mockResolvedValue([])
    metadataMock.mockReset().mockResolvedValue({ pages: 1 })
    sharpMock.mockReset().mockImplementation(() => ({ metadata: metadataMock }))
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

  it('falls back to generic image probing when a .png file contains non-PNG image data', async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-wrong-png-ext-'))
    const filePath = path.join(tempDirectory, 'wrong-extension.png')

    try {
      await fs.writeFile(filePath, Buffer.from('ffd8ffe000104a46494600010101006000600000', 'hex'))

      await expect(detectAnimatedImage(filePath, '/artist/wrong-extension.png')).resolves.toBe(false)
      expect(sharpMock).toHaveBeenCalledWith(filePath, {
        animated: true,
        limitInputPixels: false
      })
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
