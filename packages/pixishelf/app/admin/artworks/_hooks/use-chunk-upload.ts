import { VIDEO_EXTENSIONS } from '@/lib/constant'
import { MAX_MEDIA_UPLOAD_SIZE_BYTES, MAX_MEDIA_UPLOAD_SIZE_LABEL } from '@/lib/upload-limits'
import type {
  ArtworkMediaApiErrorResponse,
  MediaUploadChunkResponse,
  MediaUploadStatusResponse
} from '@/types/artwork-media-api'

type UploadProgressCallback = (percent: number) => void

export function useChunkUpload() {
  /**
   * 分片上传单个文件
   * 支持分片上传与断点续传（仅视频文件）：返回值为服务端最终元数据，不保证每片返回数据。
   */
  const uploadSingleFile = async (
    file: File,
    fileName: string,
    targetDir: string,
    targetRelDir: string,
    onProgress?: UploadProgressCallback
  ): Promise<any> => {
    const CHUNK_SIZE = 10 * 1024 * 1024 // 10MB 分片大小
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    let lastMeta = null

    if (file.size > MAX_MEDIA_UPLOAD_SIZE_BYTES) {
      throw new Error(`文件大小超过限制（${MAX_MEDIA_UPLOAD_SIZE_LABEL}）`)
    }

    // 仅对视频文件做“已存在分片”探测；图片类文件每次从 chunk 0 开始，可避免误用不一致元数据。
    let resumeIndex = 0
    const isVideo = VIDEO_EXTENSIONS.includes('.' + (fileName.split('.').pop() || '').toLowerCase())

    if (isVideo) {
      try {
        const checkUrl = `/api/artwork/upload-chunk?fileName=${encodeURIComponent(
          fileName
        )}&targetDir=${encodeURIComponent(targetDir)}`
        const checkRes = await fetch(checkUrl)
        if (checkRes.ok) {
          const checkData = (await checkRes.json()) as MediaUploadStatusResponse
          if (checkData.exists && checkData.size > 0) {
            // 如果文件存在，从最后一个完整分片开始续传
            resumeIndex = Math.floor(checkData.size / CHUNK_SIZE)
          }
        }
      } catch (e) {
        console.warn('Failed to check file status, starting from scratch', e)
      }
    }

    const startIndex = Math.min(resumeIndex, Math.max(0, totalChunks - 1))

    // 探测失败时 resumeIndex 保持为 0；服务端进度超过范围时最多从最后一片重新上传。
    for (let chunkIndex = startIndex; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)

      // 分片元数据通过请求头传递，服务端据此重组文件与校验顺序，offset/total-chunks 不可任意更改。
      const headers: Record<string, string> = {
        'x-file-name': encodeURIComponent(fileName),
        'x-target-dir': encodeURIComponent(targetDir),
        'x-target-rel-dir': encodeURIComponent(targetRelDir || ''),
        'x-chunk-index': chunkIndex.toString(),
        'x-total-chunks': totalChunks.toString(),
        'x-offset': start.toString(),
        'x-file-size': file.size.toString()
      }

      const res = await fetch('/api/artwork/upload-chunk', {
        method: 'POST',
        headers,
        body: chunk
      })

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Partial<ArtworkMediaApiErrorResponse>
        throw new Error(err.error || `Chunk ${chunkIndex} failed`)
      }

      // 约定：仅最后一个分片返回 meta；在此处更新避免每片都重复 parse 返回体。
      if (chunkIndex === totalChunks - 1) {
        const json = (await res.json()) as MediaUploadChunkResponse
        if (json.meta) {
          lastMeta = json.meta[0]
        }
      }

      onProgress?.(Math.round(((chunkIndex + 1) / totalChunks) * 100))
    }

    return lastMeta
  }

  return {
    uploadSingleFile
  }
}
