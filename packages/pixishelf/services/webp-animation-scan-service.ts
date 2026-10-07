import 'server-only'

import { getFileExtension } from '@/lib/media'
import * as fs from 'node:fs/promises'
import sharp from 'sharp'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const APNG_CONTROL_DATA_LENGTH = 8

export interface WebpAnimationScanProgress {
  percentage: number
  message: string
}

export interface WebpAnimationScanFailedSample {
  id: number
  path: string
  errorCode:
    | 'PATH_OUTSIDE_SCAN_ROOT'
    | 'MEDIA_FILE_NOT_FOUND'
    | 'MEDIA_FILE_UNREADABLE'
    | 'INVALID_ANIMATION_MEDIA'
    | 'ANIMATION_PROBE_FAILED'
  error: string
}

export interface WebpAnimationScanResult {
  initialized: number
  processed: number
  animated: number
  static: number
  failed: number
  remainingPending: number
  failedSamples: WebpAnimationScanFailedSample[]
}

export async function detectAnimatedWebp(absolutePath: string): Promise<boolean> {
  return detectAnimatedFrameImage(absolutePath)
}

/** 根据文件内容识别 WebP、GIF、PNG/APNG 是否包含多帧动画。 */
export async function detectAnimatedImage(absolutePath: string, mediaPath = absolutePath): Promise<boolean> {
  const extension = getFileExtension(mediaPath)
  if (extension === '.png' || extension === '.apng') {
    try {
      return await detectAnimatedPng(absolutePath)
    } catch (error) {
      if (!isInvalidPngProbeError(error)) throw error
      return detectAnimatedFrameImage(absolutePath)
    }
  }
  if (extension === '.webp' || extension === '.gif') {
    return detectAnimatedFrameImage(absolutePath)
  }
  throw new Error(`Unsupported animation probe format: ${extension || '<none>'}`)
}

async function detectAnimatedFrameImage(absolutePath: string): Promise<boolean> {
  const metadata = await sharp(absolutePath, { animated: true, limitInputPixels: false }).metadata()
  return (metadata.pages ?? 1) > 1
}

/** APNG 的 acTL 块必须出现在第一个 IDAT 块之前，因此无需解码完整图片。 */
async function detectAnimatedPng(absolutePath: string): Promise<boolean> {
  const file = await fs.open(absolutePath, 'r')

  try {
    const signature = Buffer.alloc(PNG_SIGNATURE.length)
    const signatureRead = await file.read(signature, 0, signature.length, 0)
    if (signatureRead.bytesRead !== signature.length || !signature.equals(PNG_SIGNATURE)) {
      throw new Error('Invalid PNG signature')
    }

    let position = PNG_SIGNATURE.length
    const chunkHeader = Buffer.alloc(8)

    while (true) {
      const headerRead = await file.read(chunkHeader, 0, chunkHeader.length, position)
      if (headerRead.bytesRead !== chunkHeader.length) {
        throw new Error('Invalid PNG chunk header')
      }

      const chunkLength = chunkHeader.readUInt32BE(0)
      const chunkType = chunkHeader.toString('ascii', 4, 8)
      if (chunkType === 'acTL') {
        if (chunkLength !== APNG_CONTROL_DATA_LENGTH) {
          throw new Error(`Invalid acTL chunk length: ${chunkLength}`)
        }

        const controlDataAndCrc = Buffer.alloc(APNG_CONTROL_DATA_LENGTH + 4)
        const controlRead = await file.read(
          controlDataAndCrc,
          0,
          controlDataAndCrc.length,
          position + chunkHeader.length
        )
        if (controlRead.bytesRead !== controlDataAndCrc.length) {
          throw new Error('Invalid acTL chunk data')
        }

        const controlData = controlDataAndCrc.subarray(0, APNG_CONTROL_DATA_LENGTH)
        const storedCrc = controlDataAndCrc.readUInt32BE(APNG_CONTROL_DATA_LENGTH)
        const calculatedCrc = calculatePngCrc32(Buffer.concat([chunkHeader.subarray(4, 8), controlData]))
        if (storedCrc !== calculatedCrc) {
          throw new Error('Invalid acTL chunk CRC')
        }

        const frameCount = controlData.readUInt32BE(0)
        if (frameCount === 0) {
          throw new Error('Invalid acTL num_frames: 0')
        }

        return frameCount > 1
      }
      if (chunkType === 'IDAT' || chunkType === 'IEND') return false

      position += chunkLength + 12
    }
  } finally {
    await file.close()
  }
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

function isInvalidPngProbeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  return message === 'Invalid PNG signature'
}
