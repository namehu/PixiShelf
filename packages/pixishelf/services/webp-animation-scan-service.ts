import 'server-only'

import path from 'path'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { EWebpAnimationStatus } from '@/enums/EWebpAnimationStatus'

const WEBP_SCAN_BATCH_SIZE = 20
const FAILED_SAMPLE_LIMIT = 20
const PENDING_WEBP_WHERE = {
  webpAnimationStatus: EWebpAnimationStatus.pending,
  path: { endsWith: '.webp', mode: 'insensitive' as const }
}

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
  const metadata = await sharp(absolutePath, { animated: true, limitInputPixels: false }).metadata()
  return (metadata.pages ?? 1) > 1
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

  await reportProgress(1, '初始化 WebP 待处理状态...')
  const initialized = await initializePendingWebpImages()

  await ensureNotCancelled()
  const totalPending = await prisma.image.count({
    where: PENDING_WEBP_WHERE
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
    await reportProgress(100, `没有待处理 WebP 图片，本次初始化 ${initialized} 个`)
    return result
  }

  let lastSeenId = 0
  await reportProgress(5, `待处理 WebP 图片 ${totalPending} 个，每批 ${WEBP_SCAN_BATCH_SIZE} 个`)

  while (true) {
    await ensureNotCancelled()

    const batch = await prisma.image.findMany({
      where: {
        ...PENDING_WEBP_WHERE,
        id: { gt: lastSeenId }
      },
      orderBy: { id: 'asc' },
      take: WEBP_SCAN_BATCH_SIZE,
      select: { id: true, path: true }
    })

    if (batch.length === 0) {
      break
    }

    lastSeenId = batch[batch.length - 1]!.id

    for (const image of batch) {
      try {
        const absolutePath = resolvePathWithinScanRoot(options.scanPath, image.path)
        const isAnimated = await detectAnimatedWebp(absolutePath)
        await prisma.image.update({
          where: { id: image.id },
          data: {
            webpAnimationStatus: isAnimated ? EWebpAnimationStatus.animated : EWebpAnimationStatus.static
          }
        })

        result.processed += 1
        if (isAnimated) {
          result.animated += 1
        } else {
          result.static += 1
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

    const attempts = result.processed + result.failed
    const percentage = Math.min(99, 5 + Math.floor((attempts / totalPending) * 94))
    await reportProgress(
      percentage,
      `已处理 ${result.processed} 个，失败 ${result.failed} 个，动图 ${result.animated} 个`
    )
  }

  result.remainingPending = await prisma.image.count({
    where: PENDING_WEBP_WHERE
  })

  await reportProgress(
    100,
    `WebP 识别完成：动图 ${result.animated} 个，静态 ${result.static} 个，失败 ${result.failed} 个`
  )

  return result
}

async function initializePendingWebpImages(): Promise<number> {
  const updateResult = await prisma.image.updateMany({
    where: {
      webpAnimationStatus: null,
      path: { endsWith: '.webp', mode: 'insensitive' }
    },
    data: { webpAnimationStatus: EWebpAnimationStatus.pending }
  })

  return updateResult.count
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
