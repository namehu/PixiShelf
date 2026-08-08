import 'server-only'

import * as fs from 'node:fs/promises'
import path from 'path'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { EMediaAnimationStatus } from '@/enums/EMediaAnimationStatus'
import { getFileExtension } from '@/lib/media'

const ANIMATION_SCAN_BATCH_SIZE = 20
const ANIMATION_INITIALIZE_BATCH_SIZE = 1000
const FAILED_SAMPLE_LIMIT = 20
const ANIMATION_PATH_FILTERS = ['.webp', '.gif', '.png', '.apng'].map((extension) => ({
  path: { endsWith: extension, mode: 'insensitive' as const }
}))
const PENDING_ANIMATION_WHERE = {
  webpAnimationStatus: EMediaAnimationStatus.pending,
  OR: ANIMATION_PATH_FILTERS
}
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const APNG_CONTROL_DATA_LENGTH = 8

export interface WebpAnimationScanProgress {
  percentage: number
  message: string
}

export interface WebpAnimationScanFailedSample {
  id: number
  path: string
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
    return detectAnimatedPng(absolutePath)
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

export async function runWebpAnimationScanJob(options: {
  scanPath: string
  onProgress?: (progress: WebpAnimationScanProgress) => Promise<void> | void
  checkCancelled?: () => Promise<boolean> | boolean
}): Promise<WebpAnimationScanResult> {
  const reportProgress = async (percentage: number, message: string) => {
    await options.onProgress?.({ percentage, message })
  }

  const ensureNotCancelled = async () => {
    if (await options.checkCancelled?.()) {
      throw new Error('Task cancelled')
    }
  }

  await reportProgress(1, '初始化待识别动画图片...')
  const initialized = await initializePendingAnimationImages()

  await ensureNotCancelled()
  const totalPending = await prisma.image.count({
    where: PENDING_ANIMATION_WHERE
  })

  const result: WebpAnimationScanResult = {
    initialized,
    processed: 0,
    animated: 0,
    static: 0,
    failed: 0,
    remainingPending: totalPending,
    failedSamples: []
  }

  if (totalPending === 0) {
    await reportProgress(100, `没有待识别动画图片，本次初始化 ${initialized} 个`)
    return result
  }

  let lastSeenId = 0
  await reportProgress(5, `待识别动画图片 ${totalPending} 个，每批 ${ANIMATION_SCAN_BATCH_SIZE} 个`)

  while (true) {
    await ensureNotCancelled()

    const batch = await prisma.image.findMany({
      where: {
        ...PENDING_ANIMATION_WHERE,
        id: { gt: lastSeenId }
      },
      orderBy: { id: 'asc' },
      take: ANIMATION_SCAN_BATCH_SIZE,
      select: { id: true, path: true }
    })

    if (batch.length === 0) {
      break
    }

    lastSeenId = batch[batch.length - 1]!.id
    const animatedIds: number[] = []
    const staticIds: number[] = []

    for (const image of batch) {
      try {
        const absolutePath = resolvePathWithinScanRoot(options.scanPath, image.path)
        const isAnimated = await detectAnimatedImage(absolutePath, image.path)
        if (isAnimated) {
          animatedIds.push(image.id)
        } else {
          staticIds.push(image.id)
        }
      } catch (error) {
        result.failed += 1
        if (result.failedSamples.length < FAILED_SAMPLE_LIMIT) {
          result.failedSamples.push({
            id: image.id,
            path: image.path,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      }
    }

    if (animatedIds.length > 0) {
      await prisma.image.updateMany({
        where: { id: { in: animatedIds } },
        data: {
          webpAnimationStatus: EMediaAnimationStatus.animated,
          mediaType: 'ANIMATION'
        }
      })
    }
    if (staticIds.length > 0) {
      await prisma.image.updateMany({
        where: { id: { in: staticIds } },
        data: {
          webpAnimationStatus: EMediaAnimationStatus.static,
          mediaType: 'IMAGE'
        }
      })
    }

    result.animated += animatedIds.length
    result.static += staticIds.length
    result.processed += animatedIds.length + staticIds.length

    const attempts = result.processed + result.failed
    const percentage = Math.min(99, 5 + Math.floor((attempts / totalPending) * 94))
    await reportProgress(
      percentage,
      `已处理 ${result.processed} 个，失败 ${result.failed} 个，动图 ${result.animated} 个`
    )
  }

  result.remainingPending = await prisma.image.count({
    where: PENDING_ANIMATION_WHERE
  })

  await reportProgress(
    100,
    `动画图片识别完成：动图 ${result.animated} 个，静态 ${result.static} 个，失败 ${result.failed} 个`
  )

  return result
}

async function initializePendingAnimationImages(): Promise<number> {
  let initialized = 0
  let lastSeenId = 0

  while (true) {
    const candidates = await prisma.image.findMany({
      where: {
        webpAnimationStatus: null,
        OR: ANIMATION_PATH_FILTERS,
        id: { gt: lastSeenId }
      },
      orderBy: { id: 'asc' },
      take: ANIMATION_INITIALIZE_BATCH_SIZE,
      select: { id: true }
    })
    if (candidates.length === 0) break

    lastSeenId = candidates[candidates.length - 1]!.id
    const updateResult = await prisma.image.updateMany({
      where: { id: { in: candidates.map(({ id }) => id) } },
      data: { webpAnimationStatus: EMediaAnimationStatus.pending }
    })
    initialized += updateResult.count
  }

  return initialized
}

function resolvePathWithinScanRoot(scanRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(scanRoot)
  const resolvedPath = path.resolve(normalizedRoot, relativePath.replace(/^[/\\]+/, ''))
  const rootWithSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`

  if (resolvedPath !== normalizedRoot && !resolvedPath.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    throw new Error(`Path escapes scan root: ${relativePath}`)
  }

  return resolvedPath
}
