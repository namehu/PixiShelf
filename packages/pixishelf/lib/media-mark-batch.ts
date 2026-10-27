import type { MediaMarkIdentity } from './media-mark-state'
import type { QueryClient } from '@tanstack/react-query'
import type { MediaMarkStateDto } from '@/schemas/media-mark.dto'

interface PendingRead {
  mediaId: number
  signal: AbortSignal
  resolve: (state: MediaMarkStateDto) => void
  reject: (error: unknown) => void
}

const batches = new WeakMap<QueryClient, Map<string, PendingRead[]>>()

/** Batch transport only: each media keeps its own query cancellation and save revision. */
export function readMediaMarkBatch(
  client: QueryClient,
  { owner, artworkId, mediaId }: MediaMarkIdentity,
  signal: AbortSignal,
  read: (mediaIds: number[], signal: AbortSignal) => Promise<{ items: MediaMarkStateDto[] }>
) {
  let groups = batches.get(client)
  if (!groups) batches.set(client, (groups = new Map()))
  const key = JSON.stringify([owner, artworkId])
  const existing = groups.get(key)
  const pending = existing ?? []
  const result = new Promise<MediaMarkStateDto>((resolve, reject) => pending.push({ mediaId, signal, resolve, reject }))
  if (existing) return result
  groups.set(key, pending)
  queueMicrotask(async () => {
    groups.delete(key)
    const active = pending.filter((item) => {
      if (!item.signal.aborted) return true
      item.reject(new DOMException('Aborted', 'AbortError'))
      return false
    })
    // The public endpoint accepts at most 200 IDs; normal preview windows contain four.
    for (let offset = 0; offset < active.length; offset += 200) {
      const chunk = active.slice(offset, offset + 200)
      const controller = new AbortController()
      const abort = () => {
        if (chunk.every((item) => item.signal.aborted)) controller.abort()
      }
      chunk.forEach((item) => item.signal.addEventListener('abort', abort))
      try {
        abort()
        const response = await read([...new Set(chunk.map((item) => item.mediaId))], controller.signal)
        for (const item of chunk) {
          const state = response.items.find((state) => state.mediaId === item.mediaId && state.artworkId === artworkId)
          if (item.signal.aborted) item.reject(new DOMException('Aborted', 'AbortError'))
          else if (state) item.resolve(state)
          else item.reject(new Error('图片标记读取不完整'))
        }
      } catch (error) {
        chunk.forEach((item) => item.reject(error))
      } finally {
        chunk.forEach((item) => item.signal.removeEventListener('abort', abort))
      }
    }
  })
  return result
}
