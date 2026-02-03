import { VIDEO_EXTENSIONS } from '../../../../../lib/constant'

type UploadProgressCallback = (percent: number) => void

export function useChunkUpload() {
  /**
   * Upload a single file in chunks
   */
  const uploadSingleFile = async (
    file: File,
    fileName: string,
    targetDir: string,
    targetRelDir: string,
    onProgress?: UploadProgressCallback
  ): Promise<any> => {
    const CHUNK_SIZE = 10 * 1024 * 1024 // 10MB
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    let lastMeta = null

    // 1. Check if file exists on server to resume (Video only)
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
            // If file exists, resume from the last complete chunk
            resumeIndex = Math.floor(checkData.size / CHUNK_SIZE)
          }
        }
      } catch (e) {
        console.warn('Failed to check file status, starting from scratch', e)
      }
    }

    const startIndex = Math.min(resumeIndex, Math.max(0, totalChunks - 1))

    for (let chunkIndex = startIndex; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)

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
