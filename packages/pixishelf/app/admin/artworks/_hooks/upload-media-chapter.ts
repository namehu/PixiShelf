import { confirm } from '@/components/shared/global-confirm'
import type { ContentWriteAuthorization } from '@/schemas/media-content.dto'
import type {
  MediaChapterUploadResponse,
  ArtworkMediaApiErrorResponse,
  MediaUploadStatusResponse
} from '@/types/artwork-media-api'
import { buildCanonicalChapterFileName } from '@/utils/artwork/video-chapter-files'

export async function postMediaChapterUpload(input: {
  artworkId: number
  imageId?: number
  videoPath: string
  file: File
  userId: string
  parent?: ContentWriteAuthorization
}) {
  if (!input.userId) throw new Error('请登录后上传。')
  const normalized = input.videoPath.replace(/^\/+/, '')
  const targetDir = normalized.slice(0, normalized.lastIndexOf('/'))
  const fileName = buildCanonicalChapterFileName(normalized.slice(normalized.lastIndexOf('/') + 1))
  const key = `pixishelf:chapter:v1:${JSON.stringify([input.userId, input.parent?.handle.writeId, input.artworkId, normalized])}`
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await input.file.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('')
  const existing = localStorage.getItem(key)
  const saved: {
    sessionId: string
    token: string
    requestId: string
    hash: string
    authorization?: ContentWriteAuthorization
  } = existing
    ? JSON.parse(existing)
    : {
        sessionId: input.parent?.sessionId ?? crypto.randomUUID(),
        token: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        hash
      }
  if (saved.hash !== hash) throw new Error('此章节路径有未结束的上传，请先完成或恢复原会话。')
  const persist = () => localStorage.setItem(key, JSON.stringify(saved))
  persist()
  const headers = {
    'x-expected-user-id': input.userId,
    'x-upload-session-id': saved.sessionId,
    'x-upload-token': saved.token
  }
  if (existing) {
    const response = await fetch(
      `/api/artwork/upload-chunk?fileName=${encodeURIComponent(fileName)}&targetDir=${encodeURIComponent(targetDir)}`,
      { headers }
    )
    const checkpoint = (await response.json()) as MediaUploadStatusResponse & Partial<ArtworkMediaApiErrorResponse>
    if (!response.ok) throw new Error(checkpoint.error || '无法核对章节上传。')
    saved.authorization = checkpoint.authorization
    if (checkpoint.status === 'RECOVERY_REQUIRED') {
      if (input.parent) throw new Error('请恢复原替换会话后重新上传章节。')
      const accepted = await new Promise<boolean>((resolve) =>
        confirm({
          title: '重新上传章节？',
          confirmText: '重新上传',
          onConfirm: () => {
            resolve(true)
          },
          onCancel: () => {
            resolve(false)
          }
        })
      )
      if (!accepted) throw new Error('章节上传保持暂停。')
      const restart = await fetch('/api/artwork/upload-chunk', {
        method: 'PATCH',
        headers: {
          ...headers,
          'x-file-name': encodeURIComponent(fileName),
          'x-target-dir': encodeURIComponent(targetDir),
          'x-upload-authorization': JSON.stringify(saved.authorization)
        }
      })
      const result = (await restart.json()) as MediaUploadStatusResponse & Partial<ArtworkMediaApiErrorResponse>
      if (!restart.ok) throw new Error(result.error || '无法重新上传章节。')
      saved.authorization = result.authorization
      saved.requestId = crypto.randomUUID()
    }
    persist()
  }
  const form = new FormData()
  form.set('artworkId', String(input.artworkId))
  if (input.imageId) form.set('imageId', String(input.imageId))
  form.set('videoPath', input.videoPath)
  form.set('file', input.file)
  form.set('expectedUserId', input.userId)
  form.set('uploadSessionId', saved.sessionId)
  form.set('uploadToken', saved.token)
  form.set('uploadRequestId', saved.requestId)
  if (saved.authorization) form.set('uploadAuthorization', JSON.stringify(saved.authorization))
  if (input.parent) form.set('authorization', JSON.stringify(input.parent))
  const response = await fetch('/api/artwork/media-chapters/upload', { method: 'POST', body: form })
  const data = (await response.json()) as MediaChapterUploadResponse & Partial<ArtworkMediaApiErrorResponse>
  if (!response.ok) throw new Error(data.error || '章节上传失败')
  saved.authorization = data.meta.uploadReceipt?.authorization
  persist()
  if (!input.parent) localStorage.removeItem(key)
  return data.meta
}
