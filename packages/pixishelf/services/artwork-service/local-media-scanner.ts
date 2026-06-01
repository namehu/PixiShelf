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
}

const supportedMediaExtensions = new Set(MEDIA_EXTENSIONS)
const supportedVideoExtensions = new Set(VIDEO_EXTENSIONS)

/**
 * 从本地作品目录构建媒体与章节入库元数据。
 * 适用于 LOCAL_CREATED 作品重扫，保留用户维护的作品元数据，只刷新媒体文件清单。
 */
export async function scanLocalArtworkMediaDirectory(input: {
  scanPath: string
  targetDirectoryRelativePath: string
}): Promise<LocalArtworkMediaScanResult> {
  const { scanPath, targetDirectoryRelativePath } = input
  const targetDir = resolvePathWithinScanRoot(scanPath, targetDirectoryRelativePath)
  const targetRelDir = normalizeStoredDir(targetDirectoryRelativePath)
  const entries = await fs.readdir(targetDir)
  const filesMeta: ImageMeta[] = []
  const chaptersMeta: ReplaceChapterMetaInput[] = []
  const warnings: string[] = []

  for (const entry of entries) {
    const extension = path.extname(entry).toLowerCase()
    if (!supportedMediaExtensions.has(extension)) {
      continue
    }

    const absolutePath = path.join(targetDir, entry)
    const stats = await fs.stat(absolutePath)
    if (!stats.isFile()) {
      continue
    }

    let width = 0
    let height = 0
    const isVideo = supportedVideoExtensions.has(extension)

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
    filesMeta.push({
      fileName: entry,
      order: extractOrderFromName(entry),
      width,
      height,
      size: stats.size,
      path: storedPath
    })

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
  }

  filesMeta.sort((a, b) => a.order - b.order || a.fileName.localeCompare(b.fileName))

  return {
    filesMeta,
    chaptersMeta,
    warnings
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
