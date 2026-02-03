import { VIDEO_EXTENSIONS } from '../../../../../lib/constant'

type UploadProgressCallback = (percent: number) => void

export function useChunkUpload() {
  /**
   * 分片上传单个文件
   * 支持大文件切片上传和断点续传（仅视频）
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

    // 1. 检查服务器上是否存在文件以支持断点续传（仅限视频）
    let resumeIndex = 0
    const isVideo = VIDEO_EXTENSIONS.includes('.' + (fileName.split('.').pop() || '').toLowerCase())

    if (isVideo) {
      try {
        const checkUrl = `/api/artwork/upload-chunk?fileName=${encodeURIComponent(
          fileName
        )}&targetDir=${encodeURIComponent(targetDir)}`
        const checkRes = await fetch(checkUrl)
        if (checkRes.ok) {
          const checkData = await checkRes.json()
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

    // 2. 循环上传分片
    for (let chunkIndex = startIndex; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)

      // 构建分片上传所需的请求头
      const headers: Record<string, string> = {
        'x-file-name': encodeURIComponent(fileName),
        'x-target-dir': encodeURIComponent(targetDir),
        'x-target-rel-dir': encodeURIComponent(targetRelDir || ''),
        'x-chunk-index': chunkIndex.toString(),
        'x-total-chunks': totalChunks.toString(),
        'x-offset': start.toString()
      }

      const res = await fetch('/api/artwork/upload-chunk', {
        method: 'POST',
        headers,
        body: chunk
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Chunk ${chunkIndex} failed`)
      }

      // 如果是最后一个分片，获取文件元数据
      if (chunkIndex === totalChunks - 1) {
        const json = await res.json()
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
