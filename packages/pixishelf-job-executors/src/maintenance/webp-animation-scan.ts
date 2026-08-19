import * as fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { MaintenanceOperationInput } from './types.ts'
import { throwIfMaintenanceAborted } from './types.ts'

export const ANIMATION_SCAN_BATCH_SIZE = 20
export const ANIMATION_INITIALIZE_BATCH_SIZE = 500
const FAILED_SAMPLE_LIMIT = 20
const ANIMATION_STATUS = { pending: 0, static: 1, animated: 2 } as const
const ANIMATION_EXTENSIONS = ['.webp', '.gif', '.png', '.apng']
const PATH_FILTERS = ANIMATION_EXTENSIONS.map((extension) => ({
  path: { endsWith: extension, mode: 'insensitive' as const }
}))
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const APNG_CONTROL_DATA_LENGTH = 8
const SHARP_INPUT_PIXEL_LIMIT = 268_402_689

export interface WebpAnimationScanResult {
  initialized: number
  processed: number
  animated: number
  static: number
  failed: number
  remainingPending: number
  failedSamples: Array<{ id: number; path: string; errorCode: WebpAnimationFailureCode; error: string }>
}

export type WebpAnimationFailureCode =
  | 'PATH_OUTSIDE_SCAN_ROOT'
  | 'MEDIA_FILE_NOT_FOUND'
  | 'MEDIA_FILE_UNREADABLE'
  | 'INVALID_ANIMATION_MEDIA'
  | 'ANIMATION_PROBE_FAILED'

export class WebpAnimationScanConfigurationError extends Error {
  readonly code = 'SCAN_ROOT_UNAVAILABLE'

  constructor() {
    super('Configured animation scan root is unavailable')
    this.name = 'WebpAnimationScanConfigurationError'
  }
}

export async function scanWebpAnimations(
  input: MaintenanceOperationInput & {
    scanRoot: string
    detectAnimated?: (absolutePath: string, mediaPath: string) => Promise<boolean>
  }
): Promise<WebpAnimationScanResult> {
  const canonicalRoot = await resolveCanonicalScanRoot(input.scanRoot)
  const detect = input.detectAnimated ?? detectAnimatedImage
  const initialized = await initializePendingAnimationImages(input)
  throwIfMaintenanceAborted(input.signal)
  const pendingWhere = { webpAnimationStatus: ANIMATION_STATUS.pending, OR: PATH_FILTERS }
  const totalPending = await input.database.image.count({ where: pendingWhere })
  const result: WebpAnimationScanResult = {
    initialized,
    processed: 0,
    animated: 0,
    static: 0,
    failed: 0,
    remainingPending: totalPending,
    failedSamples: []
  }
  let cursor = 0
  await input.progress({
    percentage: totalPending === 0 ? 100 : 5,
    stage: 'SCANNING',
    message: totalPending === 0 ? '没有待识别动画图片' : `待识别动画图片 ${totalPending} 个`,
    data: { initialized, totalPending }
  })

  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const batch = await input.database.image.findMany({
      where: { ...pendingWhere, id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: ANIMATION_SCAN_BATCH_SIZE,
      select: { id: true, path: true }
    })
    if (batch.length === 0) break
    cursor = batch.at(-1)!.id
    const animatedIds: number[] = []
    const staticIds: number[] = []
    for (const image of batch) {
      throwIfMaintenanceAborted(input.signal)
      try {
        const absolutePath = await resolveExistingPathWithinRoot(canonicalRoot, image.path)
        if (await detect(absolutePath, image.path)) animatedIds.push(image.id)
        else staticIds.push(image.id)
      } catch (error) {
        result.failed += 1
        if (result.failedSamples.length < FAILED_SAMPLE_LIMIT) {
          const failure = classifyAnimationFailure(error)
          result.failedSamples.push({
            id: image.id,
            path: safeMediaReference(image.path, image.id),
            errorCode: failure.code,
            error: failure.summary
          })
        }
      }
    }
    throwIfMaintenanceAborted(input.signal)
    await input.mutate(async (transaction) => {
      if (animatedIds.length > 0) {
        await transaction.image.updateMany({
          where: { id: { in: animatedIds }, webpAnimationStatus: ANIMATION_STATUS.pending },
          data: { webpAnimationStatus: ANIMATION_STATUS.animated, mediaType: 'ANIMATION' }
        })
      }
      if (staticIds.length > 0) {
        await transaction.image.updateMany({
          where: { id: { in: staticIds }, webpAnimationStatus: ANIMATION_STATUS.pending },
          data: { webpAnimationStatus: ANIMATION_STATUS.static, mediaType: 'IMAGE' }
        })
      }
    })
    result.animated += animatedIds.length
    result.static += staticIds.length
    result.processed += animatedIds.length + staticIds.length
    const attempts = result.processed + result.failed
    await input.progress({
      percentage: Math.min(99, 5 + Math.floor((attempts / Math.max(1, totalPending)) * 94)),
      stage: 'SCANNING',
      message: `已处理 ${result.processed} 个，失败 ${result.failed} 个，动图 ${result.animated} 个`,
      data: {
        totalPending,
        initialized: result.initialized,
        processed: result.processed,
        animated: result.animated,
        static: result.static,
        failed: result.failed,
        remainingPending: Math.max(0, totalPending - attempts)
      }
    })
  }

  throwIfMaintenanceAborted(input.signal)
  result.remainingPending = await input.database.image.count({ where: pendingWhere })
  await input.progress({
    percentage: 100,
    stage: 'COMPLETED',
    message: `动画识别完成：动图 ${result.animated} 个，静态 ${result.static} 个，失败 ${result.failed} 个`
  })
  return result
}

async function resolveCanonicalScanRoot(scanRoot: string): Promise<string> {
  try {
    return await fs.realpath(scanRoot)
  } catch {
    throw new WebpAnimationScanConfigurationError()
  }
}

async function initializePendingAnimationImages(input: MaintenanceOperationInput): Promise<number> {
  let initialized = 0
  let cursor = 0
  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const candidates = await input.database.image.findMany({
      where: { webpAnimationStatus: null, OR: PATH_FILTERS, id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: ANIMATION_INITIALIZE_BATCH_SIZE,
      select: { id: true }
    })
    if (candidates.length === 0) break
    cursor = candidates.at(-1)!.id
    const result = await input.mutate((transaction) =>
      transaction.image.updateMany({
        where: { id: { in: candidates.map(({ id }) => id) }, webpAnimationStatus: null },
        data: { webpAnimationStatus: ANIMATION_STATUS.pending }
      })
    )
    initialized += result.count
  }
  return initialized
}

export async function detectAnimatedImage(absolutePath: string, mediaPath = absolutePath): Promise<boolean> {
  const extension = path.extname(mediaPath).toLowerCase()
  if (extension === '.png' || extension === '.apng') return detectAnimatedPng(absolutePath)
  if (extension === '.webp' || extension === '.gif') {
    const metadata = await sharp(absolutePath, {
      animated: true,
      failOn: 'error',
      limitInputPixels: SHARP_INPUT_PIXEL_LIMIT,
      sequentialRead: true
    }).metadata()
    return (metadata.pages ?? 1) > 1
  }
  throw new Error(`Unsupported animation probe format: ${extension || '<none>'}`)
}

async function detectAnimatedPng(absolutePath: string): Promise<boolean> {
  const file = await fs.open(absolutePath, 'r')
  try {
    const fileSize = (await file.stat()).size
    const signature = Buffer.alloc(PNG_SIGNATURE.length)
    const signatureRead = await file.read(signature, 0, signature.length, 0)
    if (signatureRead.bytesRead !== signature.length || !signature.equals(PNG_SIGNATURE)) {
      throw new Error('Invalid PNG signature')
    }
    let position = PNG_SIGNATURE.length
    const chunkHeader = Buffer.alloc(8)
    while (position + 12 <= fileSize) {
      const headerRead = await file.read(chunkHeader, 0, chunkHeader.length, position)
      if (headerRead.bytesRead !== chunkHeader.length) throw new Error('Invalid PNG chunk header')
      const chunkLength = chunkHeader.readUInt32BE(0)
      const chunkType = chunkHeader.toString('ascii', 4, 8)
      if (position + chunkLength + 12 > fileSize) throw new Error('PNG chunk exceeds file length')
      if (chunkType === 'acTL') {
        if (chunkLength !== APNG_CONTROL_DATA_LENGTH) throw new Error(`Invalid acTL chunk length: ${chunkLength}`)
        const controlDataAndCrc = Buffer.alloc(APNG_CONTROL_DATA_LENGTH + 4)
        const controlRead = await file.read(controlDataAndCrc, 0, controlDataAndCrc.length, position + 8)
        if (controlRead.bytesRead !== controlDataAndCrc.length) throw new Error('Invalid acTL chunk data')
        const controlData = controlDataAndCrc.subarray(0, APNG_CONTROL_DATA_LENGTH)
        const storedCrc = controlDataAndCrc.readUInt32BE(APNG_CONTROL_DATA_LENGTH)
        const calculatedCrc = pngCrc32(Buffer.concat([chunkHeader.subarray(4, 8), controlData]))
        if (storedCrc !== calculatedCrc) throw new Error('Invalid acTL chunk CRC')
        const frameCount = controlData.readUInt32BE(0)
        if (frameCount === 0) throw new Error('Invalid acTL num_frames: 0')
        return frameCount > 1
      }
      if (chunkType === 'IDAT' || chunkType === 'IEND') return false
      position += chunkLength + 12
    }
    throw new Error('PNG ended before IDAT or IEND')
  } finally {
    await file.close()
  }
}

async function resolveExistingPathWithinRoot(canonicalRoot: string, relativePath: string): Promise<string> {
  const candidate = path.resolve(canonicalRoot, relativePath.replace(/^[/\\]+/, ''))
  assertWithinRoot(canonicalRoot, candidate)
  const canonicalCandidate = await fs.realpath(candidate)
  assertWithinRoot(canonicalRoot, canonicalCandidate)
  const stat = await fs.stat(canonicalCandidate)
  if (!stat.isFile()) throw new Error('Animation probe path is not a file')
  return canonicalCandidate
}

function assertWithinRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw new Error('Animation probe path is outside the configured scan root')
}

function safeMediaReference(mediaPath: string, imageId: number): string {
  const source = mediaPath.replace(/\\/g, '/')
  const normalized = source.replace(/^\/+/, '')
  if (source.startsWith('//') || /^[a-z]:\//i.test(source) || normalized.split('/').includes('..')) {
    return `image:${imageId}`
  }
  return normalized.slice(0, 240) || `image:${imageId}`
}

function classifyAnimationFailure(error: unknown): { code: WebpAnimationFailureCode; summary: string } {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null
  const message = error instanceof Error ? error.message : ''
  if (message.includes('outside the configured scan root')) {
    return { code: 'PATH_OUTSIDE_SCAN_ROOT', summary: 'Media path is outside the configured scan root' }
  }
  if (code === 'ENOENT') return { code: 'MEDIA_FILE_NOT_FOUND', summary: 'Media file was not found' }
  if (code === 'EACCES' || code === 'EPERM') {
    return { code: 'MEDIA_FILE_UNREADABLE', summary: 'Media file could not be read' }
  }
  if (/Invalid PNG|PNG chunk|acTL|unsupported animation probe format/i.test(message)) {
    return { code: 'INVALID_ANIMATION_MEDIA', summary: 'Media file is not a valid supported animation image' }
  }
  return { code: 'ANIMATION_PROBE_FAILED', summary: 'Animation detection failed' }
}

function pngCrc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
