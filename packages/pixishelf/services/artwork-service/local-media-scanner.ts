import 'server-only'

import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from '@/lib/constant'
import { extractOrderFromName } from '@/utils/artwork/extract-order-from-name'
import { discoverChaptersForVideoInScanRoot } from '@/services/artwork-service/video-chapters'
import { ImageMeta, ReplaceChapterMetaInput } from './image-manager'

export interface LocalArtworkMediaScanResult {
  filesMeta: ImageMeta[]
  chaptersMeta: ReplaceChapterMetaInput[]
  warnings: string[]
  earliestMediaMtime: Date | null
}

const supportedMediaExtensions = new Set(MEDIA_EXTENSIONS)
const supportedVideoExtensions = new Set(VIDEO_EXTENSIONS)
const MEDIA_METADATA_CONCURRENCY = 8

/**
 * 从本地作品目录构建媒体与章节入库元数据。
 * 适用于 LOCAL_CREATED 作品重扫，保留用户维护的作品元数据，只刷新媒体文件清单。
 */
export async function scanLocalArtworkMediaDirectory(input: {
  scanPath: string
  targetDirectoryRelativePath: string
  onProgress?: (progress: { current: number; total: number; fileName: string }) => void
  checkCancelled?: () => Promise<boolean>
}): Promise<LocalArtworkMediaScanResult> {
  const { scanPath, targetDirectoryRelativePath, onProgress, checkCancelled } = input
  await throwIfCancelled(checkCancelled)
  const targetDir = resolvePathWithinScanRoot(scanPath, targetDirectoryRelativePath)
  const targetRelDir = normalizeStoredDir(targetDirectoryRelativePath)
  const entries = await fs.readdir(targetDir)
  const mediaEntries = entries.filter((entry) => {
    const extension = path.extname(entry).toLowerCase()
    return supportedMediaExtensions.has(extension)
  })
  let completedCount = 0
  let cancelled = false
  const results = await runConcurrentMap(mediaEntries, MEDIA_METADATA_CONCURRENCY, async (entry) => {
    await throwIfCancelled(checkCancelled)
    const extension = path.extname(entry).toLowerCase()
    const absolutePath = path.join(targetDir, entry)
    const stats = await fs.stat(absolutePath)
    if (!stats.isFile()) {
      return null
    }

    let width = 0
    let height = 0
    const isVideo = supportedVideoExtensions.has(extension)
    const warnings: string[] = []
    const chaptersMeta: ReplaceChapterMetaInput[] = []

    if (!isVideo) {
      try {
        const metadata = await sharp(absolutePath).metadata()
        width = metadata.width || 0
        height = metadata.height || 0
      } catch (error) {
        warnings.push(`Failed to read image metadata for ${entry}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    const storedPath = joinStoredPath(targetRelDir, entry)
    const fileMeta: ImageMeta = {
      fileName: entry,
      order: extractOrderFromName(entry),
      width,
      height,
      size: stats.size,
      path: storedPath
    }

    if (isVideo) {
      try {
        const chapterMeta = await discoverChaptersForVideoInScanRoot(scanPath, storedPath)
        if (chapterMeta) {
          chaptersMeta.push({
            videoFileName: entry,
            chaptersFileName: path.posix.basename(chapterMeta.chaptersPath),
            ...chapterMeta
          })
        }
      } catch (error) {
        warnings.push(
          `Failed to read chapter metadata for ${entry}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }
    const result = {
      fileMeta,
      chaptersMeta,
      warnings,
      mediaMtime: stats.mtime
    }

    if (cancelled) {
      return result
    }
    completedCount += 1
    onProgress?.({
      current: completedCount,
      total: mediaEntries.length,
      fileName: entry
    })

    return result
  }, {
    shouldStop: () => cancelled,
    onError: (error) => {
      if (isCancellationError(error)) {
        cancelled = true
      }
    }
  })

  if (cancelled) {
    throw new Error('Task cancelled')
  }

  const filesMeta: ImageMeta[] = []
  const chaptersMeta: ReplaceChapterMetaInput[] = []
  const warnings: string[] = []
  let earliestMediaMtime: Date | null = null

  for (const result of results) {
    if (!result) continue
    filesMeta.push(result.fileMeta)
    chaptersMeta.push(...result.chaptersMeta)
    warnings.push(...result.warnings)
    if (!earliestMediaMtime || result.mediaMtime < earliestMediaMtime) {
      earliestMediaMtime = result.mediaMtime
    }
  }

  filesMeta.sort((a, b) => a.order - b.order || a.fileName.localeCompare(b.fileName))

  return {
    filesMeta,
    chaptersMeta,
    warnings,
    earliestMediaMtime
  }
}

async function throwIfCancelled(checkCancelled?: () => Promise<boolean>) {
  if (await checkCancelled?.()) {
    throw new Error('Task cancelled')
  }
}

function normalizeStoredDir(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  return normalized ? `/${normalized}` : ''
}

function joinStoredPath(storedDir: string, filename: string): string {
  return storedDir ? path.posix.join(storedDir, filename) : `/${filename}`
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

async function runConcurrentMap<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
  options: {
    shouldStop: () => boolean
    onError: (error: unknown) => void
  }
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0

  async function worker() {
    while (!options.shouldStop() && nextIndex < items.length) {
      const currentIndex = nextIndex++
      const item = items[currentIndex]
      if (item === undefined) continue
      try {
        results[currentIndex] = await mapper(item)
      } catch (error) {
        options.onError(error)
        if (!isCancellationError(error)) {
          throw error
        }
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  const settledWorkers = await Promise.allSettled(Array.from({ length: workerCount }, worker))
  const failedWorker = settledWorkers.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failedWorker) {
    throw failedWorker.reason
  }
  return results
}

function isCancellationError(error: unknown) {
  return error instanceof Error && error.message === 'Task cancelled'
}
