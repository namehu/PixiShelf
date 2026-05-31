import { isVideoFile } from '@/lib/media'
import { discoverChaptersForVideoInScanRoot } from '@/services/artwork-service/video-chapters'
import { MediaFileInfo } from './media-collector'
import { getRelativePath } from './path-utils'

export interface ScannedImageCreateData {
  path: string
  size: number
  sortOrder: number
  artworkId: number
  chaptersPath: string | null
  chaptersCount: number
  chaptersDuration: number | null
  chaptersUpdatedAt: Date | null
  chaptersHash: string | null
}

/**
 * 为扫描到的媒体文件构建可入库的图片数据，并附带章节摘要。
 * @param input 扫描输入
 * @returns 图片入库数据
 */
export async function buildScannedImageCreateData(input: {
  mediaFiles: MediaFileInfo[]
  artworkId: number
  scanPath: string
}): Promise<ScannedImageCreateData[]> {
  const { mediaFiles, artworkId, scanPath } = input

  return Promise.all(
    mediaFiles.map(async (mediaFile) => {
      const relativePath = getRelativePath(mediaFile.path, scanPath)
      const baseRecord: ScannedImageCreateData = {
        path: relativePath,
        size: mediaFile.size,
        sortOrder: mediaFile.sortOrder,
        artworkId,
        chaptersPath: null,
        chaptersCount: 0,
        chaptersDuration: null,
        chaptersUpdatedAt: null,
        chaptersHash: null
      }

      if (!isVideoFile(relativePath)) {
        return baseRecord
      }

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
    })
  )
}
