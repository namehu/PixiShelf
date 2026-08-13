import 'server-only'

import { createHash } from 'node:crypto'
import * as childProcess from 'node:child_process'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { VIDEO_EXTENSIONS } from '@/lib/constant'
import { resolveDerivedMediaStoragePath, VIDEO_POSTER_STORAGE_ROOT } from '@/services/derived-media-storage'
import { resolvePathWithinScanRoot } from '@/services/video-media-probe-service'
import {
  getVideoPosterImageIdFromFileName,
  isTemporaryVideoPosterFile,
  VIDEO_POSTER_LOCK_NAMESPACE
} from '@/services/video-poster-lock'

const POSTER_ROOT = VIDEO_POSTER_STORAGE_ROOT
const FAILED_SAMPLE_LIMIT = 20

export interface VideoPosterGenerationResult {
  processed: number
  generated: number
  failed: number
  skipped: number
  orphanedFilesDeleted: number
  failedSamples: Array<{ imageId: number; path: string; error: string }>
}

export interface VideoPosterProgress {
  percentage: number
  message: string
}

export async function runVideoPosterGenerationJob(options: {
  scanPath: string
  onProgress?: (progress: VideoPosterProgress) => Promise<void> | void
  checkCancelled?: () => Promise<boolean> | boolean
}): Promise<VideoPosterGenerationResult> {
  const report = (percentage: number, message: string) => options.onProgress?.({ percentage, message })
  const ensureNotCancelled = async () => {
    if (await options.checkCancelled?.()) throw new Error('Task cancelled')
  }

  await fs.mkdir(POSTER_ROOT, { recursive: true })
  await report(1, '正在清理孤儿视频封面...')
  await ensureVideoMetadataRows()
  await markMissingPostersPending()
  const orphanedFilesDeleted = await cleanupOrphanedPosters()
  await ensureNotCancelled()

  const total = await prisma.mediaVideoMetadata.count({
    where: { posterStatus: { in: ['PENDING', 'FAILED'] }, manualPosterTimestamp: null }
  })
  const result: VideoPosterGenerationResult = {
    processed: 0,
    generated: 0,
    failed: 0,
    skipped: 0,
    orphanedFilesDeleted,
    failedSamples: []
  }
  if (total === 0) {
    await report(100, `没有待生成视频封面，已清理 ${orphanedFilesDeleted} 个孤儿文件`)
    return result
  }

  await report(2, `待生成视频封面 ${total} 个，按单并发顺序处理`)
  let lastSeenId = 0
  while (true) {
    await ensureNotCancelled()
    const batch = await prisma.mediaVideoMetadata.findMany({
      where: {
        posterStatus: { in: ['PENDING', 'FAILED'] },
        manualPosterTimestamp: null,
        imageId: { gt: lastSeenId }
      },
      orderBy: { imageId: 'asc' },
      take: 50,
      select: { imageId: true, image: { select: { path: true } } }
    })
    if (batch.length === 0) break
    lastSeenId = batch[batch.length - 1]!.imageId

    for (const item of batch) {
      await ensureNotCancelled()
      result.processed += 1
      let temporaryPath: string | null = null
      try {
        const relativePosterPath = getPosterRelativePath(item.imageId, item.image.path)
        const outputPath = resolveDerivedMediaStoragePath(POSTER_ROOT, relativePosterPath)
        temporaryPath = `${outputPath}.tmp.webp`
        const claimed = await prisma.mediaVideoMetadata.updateMany({
          where: {
            imageId: item.imageId,
            posterStatus: { in: ['PENDING', 'FAILED'] },
            manualPosterTimestamp: null
          },
          data: { posterStatus: 'GENERATING', posterError: null }
        })
        if (claimed.count !== 1) {
          result.skipped += 1
          continue
        }
        await fs.mkdir(path.dirname(outputPath), { recursive: true })
        await generatePoster(resolvePathWithinScanRoot(options.scanPath, item.image.path), temporaryPath)
        let previousPosterPath: string | null = null
        const published = await prisma.$transaction(async (tx) => {
          await lockVideoPoster(tx, item.imageId)
          const current = await tx.mediaVideoMetadata.findUnique({
            where: { imageId: item.imageId },
            select: { posterStatus: true, posterPath: true, manualPosterTimestamp: true }
          })
          if (current?.posterStatus !== 'GENERATING' || current.manualPosterTimestamp !== null) return false
          previousPosterPath = current.posterPath
          await fs.rename(temporaryPath!, outputPath)
          const updated = await tx.mediaVideoMetadata.updateMany({
            where: { imageId: item.imageId, posterStatus: 'GENERATING', manualPosterTimestamp: null },
            data: {
              posterStatus: 'COMPLETED',
              posterPath: relativePosterPath,
              posterUpdatedAt: new Date(),
              posterError: null
            }
          })
          if (updated.count !== 1) throw new Error('Default poster ownership was lost')
          return true
        })
        if (published) {
          result.generated += 1
          if (previousPosterPath && previousPosterPath !== relativePosterPath) {
            await fs
              .rm(resolveDerivedMediaStoragePath(POSTER_ROOT, previousPosterPath), { force: true })
              .catch(() => undefined)
          }
        } else {
          await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
          result.skipped += 1
        }
      } catch (error) {
        if (temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
        const message = error instanceof Error ? error.message : 'Unknown error'
        result.failed += 1
        if (result.failedSamples.length < FAILED_SAMPLE_LIMIT) {
          result.failedSamples.push({ imageId: item.imageId, path: item.image.path, error: message })
        }
        await prisma.mediaVideoMetadata.updateMany({
          where: { imageId: item.imageId, posterStatus: 'GENERATING', manualPosterTimestamp: null },
          data: { posterStatus: 'FAILED', posterError: message }
        })
      }
      const percentage = Math.min(99, 2 + Math.floor((result.processed / total) * 97))
      await report(percentage, `已处理 ${result.processed}/${total}：成功 ${result.generated}，失败 ${result.failed}`)
    }
  }
  await report(
    100,
    `视频封面生成完成：成功 ${result.generated}，失败 ${result.failed}，清理孤儿 ${orphanedFilesDeleted}`
  )
  return result
}

function getPosterRelativePath(imageId: number, sourcePath: string) {
  const digest = createHash('sha256').update(sourcePath).digest('hex').slice(0, 16)
  return `${imageId}-${digest}.webp`
}

async function generatePoster(sourcePath: string, temporaryPath: string) {
  await execFfmpeg([
    '-y',
    '-ss',
    '1',
    '-i',
    sourcePath,
    '-frames:v',
    '1',
    '-vf',
    "scale='min(960,iw)':-2",
    '-c:v',
    'libwebp',
    '-q:v',
    '80',
    temporaryPath
  ])
}

export async function cleanupOrphanedPosters() {
  let deleted = 0
  const entries = await fs.readdir(POSTER_ROOT, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.webp') || isTemporaryVideoPosterFile(entry.name)) continue
    const imageId = getVideoPosterImageIdFromFileName(entry.name)
    if (imageId === null) continue
    const removed = await prisma.$transaction(async (tx) => {
      await lockVideoPoster(tx, imageId)
      const referenced = await tx.mediaVideoMetadata.findFirst({
        where: { imageId, posterPath: entry.name },
        select: { imageId: true }
      })
      if (referenced) return false
      await fs.unlink(resolveDerivedMediaStoragePath(POSTER_ROOT, entry.name))
      return true
    })
    if (removed) deleted += 1
  }
  return deleted
}

async function lockVideoPoster(
  tx: { $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown> },
  imageId: number
) {
  await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1, $2)::text', VIDEO_POSTER_LOCK_NAMESPACE, imageId)
}

async function ensureVideoMetadataRows() {
  // 独立任务不能依赖“视频媒体探测”先运行：直接按文件扩展名发现视频。
  const videos = await prisma.image.findMany({
    where: {
      OR: VIDEO_EXTENSIONS.map((extension) => ({ path: { endsWith: extension, mode: 'insensitive' } }))
    },
    select: { id: true, mediaType: true, videoMetadata: { select: { imageId: true } } }
  })
  const videoIds = videos.map((video) => video.id)
  if (videoIds.length > 0) {
    await prisma.image.updateMany({
      where: { id: { in: videoIds }, mediaType: { not: 'VIDEO' } },
      data: { mediaType: 'VIDEO' }
    })

    const missingMetadata = videos.filter((video) => !video.videoMetadata)
    await prisma.mediaVideoMetadata.createMany({
      data: missingMetadata.map((video) => ({ imageId: video.id, posterStatus: 'PENDING' })),
      skipDuplicates: true
    })
  }
}

async function markMissingPostersPending() {
  const completed = await prisma.mediaVideoMetadata.findMany({
    where: { posterStatus: 'COMPLETED', posterPath: { not: null } },
    select: { imageId: true, posterPath: true }
  })
  for (const metadata of completed) {
    const posterPath = metadata.posterPath
    if (
      !posterPath ||
      (await fs
        .stat(resolveDerivedMediaStoragePath(POSTER_ROOT, posterPath))
        .then((stat) => stat.isFile())
        .catch(() => false))
    ) {
      continue
    }
    await prisma.mediaVideoMetadata.updateMany({
      where: {
        imageId: metadata.imageId,
        posterStatus: 'COMPLETED',
        posterPath
      },
      data: { posterStatus: 'PENDING', posterPath: null, posterUpdatedAt: null, posterError: 'Poster file is missing' }
    })
  }
}

function execFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    childProcess.execFile('ffmpeg', args, { maxBuffer: 1024 * 1024 * 10 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()))
      else resolve()
    })
  })
}
