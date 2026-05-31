import { isVideoFile } from '@/lib/media'
import { discoverChaptersForVideoInScanRoot } from '@/services/artwork-service/video-chapters'
import { MediaFileInfo } from './media-collector'
import { getRelativePath } from './path-utils'

export interface ScannedImageSeedData {
  path: string
  size: number
  sortOrder: number
  chaptersPath: string | null
  chaptersCount: number
  chaptersDuration: number | null
  chaptersUpdatedAt: Date | null
  chaptersHash: string | null
}

/**
 * 为扫描到的媒体文件预构建图片数据，并附带章节摘要。
 * @param input 扫描输入
 * @returns 图片入库数据
 */
export async function buildScannedImageSeedData(input: {
  mediaFiles: MediaFileInfo[]
  scanPath: string
  onChapterWarning?: (warning: { mediaPath: string; message: string }) => void
}): Promise<ScannedImageSeedData[]> {
  const { mediaFiles, scanPath, onChapterWarning } = input

  return Promise.all(
    mediaFiles.map(async (mediaFile) => {
      const relativePath = getRelativePath(mediaFile.path, scanPath)
      const baseRecord: ScannedImageSeedData = {
        path: relativePath,
        size: mediaFile.size,
        sortOrder: mediaFile.sortOrder,
        chaptersPath: null,
        chaptersCount: 0,
        chaptersDuration: null,
        chaptersUpdatedAt: null,
        chaptersHash: null
      }

      if (!isVideoFile(relativePath)) {
        return baseRecord
      }

      try {
        const chapterMeta = await discoverChaptersForVideoInScanRoot(scanPath, relativePath)
        if (!chapterMeta) {
          return baseRecord
        }

        return {
          ...baseRecord,
          chaptersPath: chapterMeta.chaptersPath,
          chaptersCount: chapterMeta.chaptersCount,
          chaptersDuration: chapterMeta.chaptersDuration,
          chaptersUpdatedAt: new Date(),
          chaptersHash: chapterMeta.chaptersHash
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown chapter discovery error'
        onChapterWarning?.({
          mediaPath: relativePath,
          message
        })
        return baseRecord
      }
    })
  )
}

export interface ScannedImageCreateData extends ScannedImageSeedData {
  artworkId: number
}

/**
 * 将预处理后的图片数据补上 artworkId，转换为可直接入库的数据。
 * @param input 扫描输入
 * @returns 图片入库数据
 */
export async function buildScannedImageCreateData(input: {
  mediaFiles: MediaFileInfo[]
  artworkId: number
  scanPath: string
  onChapterWarning?: (warning: { mediaPath: string; message: string }) => void
}): Promise<ScannedImageCreateData[]> {
  const { artworkId, ...rest } = input
  const imageSeeds = await buildScannedImageSeedData(rest)

  return imageSeeds.map((imageSeed) => ({
    ...imageSeed,
    artworkId
  }))
}
