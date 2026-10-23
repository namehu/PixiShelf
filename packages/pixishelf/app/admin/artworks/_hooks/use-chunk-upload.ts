import { confirm } from '@/components/shared/global-confirm'
import { useRef } from 'react'
import { useSession } from '@/lib/auth/client'
import { MAX_MEDIA_UPLOAD_SIZE_BYTES, MAX_MEDIA_UPLOAD_SIZE_LABEL } from '@/lib/upload-limits'
import type {
  ArtworkMediaApiErrorResponse,
  MediaUploadChunkResponse,
  MediaUploadStatusResponse
} from '@/types/artwork-media-api'
import type { ContentWriteAuthorization, MediaUploadReceipt } from '@/schemas/media-content.dto'
import type { ImageMeta } from '@/services/artwork-service/image-manager'

type UploadProgressCallback = (percent: number) => void
type UploadState = {
  token: string
  sessionId: string
  authorization?: ContentWriteAuthorization
  requests: Record<string, string>
  hashes: Record<string, string>
  meta?: ImageMeta
}
const storageKey = (
  userId: string,
  file: File,
  fileName: string,
  targetDir: string,
  parent?: ContentWriteAuthorization
) => `pixishelf:upload:v1:${JSON.stringify([userId, parent?.handle.writeId ?? null, targetDir, fileName, file.size])}`
const sha256 = async (blob: Blob) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
const CHUNK_SIZE = 10 * 1024 * 1024

export function useChunkUpload() {
  const { data: session } = useSession()
  const state = useRef<{ userId: string; sessionId: string } | null>(null)
  const uploadSingleFile = async (
    file: File,
    fileName: string,
    targetDir: string,
    targetRelDir: string,
    options?: UploadProgressCallback | { onProgress?: UploadProgressCallback; parent?: ContentWriteAuthorization }
  ): Promise<ImageMeta> => {
    const onProgress = typeof options === 'function' ? options : options?.onProgress
    const parent = typeof options === 'function' ? undefined : options?.parent
    const userId = session?.user.id
    if (!userId) throw new Error('请登录后上传。')
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('文件为空。')
    if (file.size > MAX_MEDIA_UPLOAD_SIZE_BYTES) throw new Error(`文件大小超过限制（${MAX_MEDIA_UPLOAD_SIZE_LABEL}）`)
    if (!state.current || state.current.userId !== userId) state.current = { userId, sessionId: crypto.randomUUID() }
    const key = storageKey(userId, file, fileName, targetDir, parent)
    const stored = localStorage.getItem(key)
    const existing = stored ? (JSON.parse(stored) as UploadState) : undefined
    const upload: UploadState = existing ?? {
      token: crypto.randomUUID(),
      sessionId: parent?.sessionId ?? state.current.sessionId,
      requests: {},
      hashes: {}
    }
    const sessionId = upload.sessionId
    if (parent && sessionId !== parent.sessionId) throw new Error('上传会话不匹配。')
    const persist = () => localStorage.setItem(key, JSON.stringify(upload))
    persist()
    const identityHeaders = {
      'x-expected-user-id': userId,
      'x-upload-session-id': sessionId,
      'x-upload-token': upload.token
    }
    let startIndex = 0
    let offset = 0
    if (existing) {
      const check = await fetch(
        `/api/artwork/upload-chunk?fileName=${encodeURIComponent(fileName)}&targetDir=${encodeURIComponent(targetDir)}`,
        { headers: identityHeaders }
      )
      if (!check.ok) throw new Error('无法核对上传会话，请稍后重试。')
      let checkpoint = (await check.json()) as MediaUploadStatusResponse
      if (checkpoint.status === 'RECOVERY_REQUIRED') {
        if (parent) throw new Error('替换上传中断，请在替换会话中恢复原文件后重试。')
        const accepted = await new Promise<boolean>((resolve) =>
          confirm({
            title: '重新上传该文件？',
            description: '上次写入未完成。将从头上传当前文件，完成前保持原标记不可用。',
            confirmText: '重新上传该文件',
            onConfirm: () => {
              resolve(true)
            },
            onCancel: () => {
              resolve(false)
            }
          })
        )
        if (!accepted) throw new Error('上传保持暂停。')
        const restart = await fetch('/api/artwork/upload-chunk', {
          method: 'PATCH',
          headers: {
            ...identityHeaders,
            'x-file-name': encodeURIComponent(fileName),
            'x-target-dir': encodeURIComponent(targetDir),
            'x-upload-authorization': JSON.stringify(checkpoint.authorization)
          }
        })
        const result = (await restart.json()) as MediaUploadStatusResponse & Partial<ArtworkMediaApiErrorResponse>
        if (!restart.ok) throw new Error(result.error || '无法重启上传。')
        checkpoint = result
        upload.requests = {}
        upload.hashes = {}
        delete upload.meta
        upload.authorization = checkpoint.authorization
        persist()
      }
      if (checkpoint.exists) {
        upload.authorization = checkpoint.authorization
        for (let index = 0; index < (checkpoint.nextChunkIndex ?? 0); index++) {
          const expected = upload.hashes[String(index)]
          if (
            !expected ||
            expected !== (await sha256(file.slice(index * CHUNK_SIZE, Math.min((index + 1) * CHUNK_SIZE, file.size))))
          ) {
            throw new Error('所选文件与之前上传的内容不同，已停止续传。')
          }
        }
        if (checkpoint.status === 'COMPLETED' && upload.meta) return upload.meta
        persist()
        startIndex = checkpoint.nextChunkIndex ?? 0
        offset = checkpoint.size
        // Replaying the last receipt returns metadata after a lost final response.
        if (startIndex === Math.ceil(file.size / CHUNK_SIZE)) {
          startIndex -= 1
          offset = startIndex * CHUNK_SIZE
        }
      }
    }
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    for (let chunkIndex = startIndex; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE
      if (offset !== start) throw new Error('上传检查点不匹配，已停止写入。')
      const requestId = upload.requests[String(chunkIndex)] ?? crypto.randomUUID()
      upload.requests[String(chunkIndex)] = requestId
      upload.hashes[String(chunkIndex)] = await sha256(file.slice(start, Math.min(start + CHUNK_SIZE, file.size)))
      persist()
      const response = await fetch('/api/artwork/upload-chunk', {
        method: 'POST',
        headers: {
          ...identityHeaders,
          'x-upload-request-id': requestId,
          'x-file-name': encodeURIComponent(fileName),
          'x-target-dir': encodeURIComponent(targetDir),
          'x-target-rel-dir': encodeURIComponent(targetRelDir),
          'x-file-size': String(file.size),
          'x-chunk-index': String(chunkIndex),
          'x-total-chunks': String(totalChunks),
          'x-offset': String(start),
          ...(upload.authorization ? { 'x-upload-authorization': JSON.stringify(upload.authorization) } : {}),
          ...(parent ? { 'x-upload-parent': JSON.stringify(parent) } : {})
        },
        body: file.slice(start, Math.min(start + CHUNK_SIZE, file.size))
      })
      const result = (await response.json().catch(() => ({}))) as MediaUploadChunkResponse &
        Partial<ArtworkMediaApiErrorResponse>
      if (!response.ok) throw new Error(result.error || '上传失败。')
      upload.authorization = result.authorization
      persist()
      offset = result.committedBytes
      onProgress?.(Math.round((offset / file.size) * 100))
      if (result.type === 'final' && result.meta?.[0]) {
        upload.meta = result.meta[0]
        persist()
        return result.meta[0]
      }
    }
    throw new Error('上传结果缺少媒体信息。')
  }
  return { uploadSingleFile }
}

export function releaseMediaUploadReceipt(receipt?: MediaUploadReceipt) {
  if (!receipt) return
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index)
    if (!key?.startsWith('pixishelf:upload:v1:')) continue
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as UploadState
      if (
        stored.sessionId === receipt.authorization.sessionId &&
        stored.token === receipt.authorization.handle.writeToken &&
        stored.meta?.uploadReceipt?.expectedUserId === receipt.expectedUserId
      ) {
        localStorage.removeItem(key)
      }
    } catch {
      /* Keep unknown recovery records for inspection. */
    }
  }
}
