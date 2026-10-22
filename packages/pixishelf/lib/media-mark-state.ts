import type { QueryClient } from '@tanstack/react-query'
import type { MediaMarkKind, MediaMarkStateDto } from '@/schemas/media-mark.dto'

export interface MediaMarkSnapshot extends MediaMarkStateDto {
  isLoading: boolean
  isSaving: boolean
  error: Error | null
}

export interface MediaMarkTransport {
  get: (signal: AbortSignal) => Promise<MediaMarkStateDto>
  set: (kind: MediaMarkKind, value: boolean) => Promise<MediaMarkStateDto>
  remove: (markId: string, kind: MediaMarkKind) => Promise<unknown>
  isCurrentAccount: () => boolean
  onConfirmed: () => Promise<unknown>
}

export interface MediaMarkIdentity { owner: string; artworkId: number; mediaId: number }

const field = (kind: MediaMarkKind) => kind === 'bookmark' ? 'bookmarkedAt' : 'likedAt'
export const mediaMarkQueryKey = (owner: string, artworkId: number, mediaId: number) => ['mediaMark', 'state', owner, artworkId, mediaId] as const
export const mediaMarkListKey = (owner: string) => ['mediaMark', 'list', owner] as const

/** One queue per account/media keeps independent marks consistent across reading surfaces. */
export class MediaMarkSession {
  private listeners = new Set<() => void>()
  private confirmed: MediaMarkStateDto
  private snapshot: MediaMarkSnapshot
  private pending = new Map<MediaMarkKind, { value: boolean; markId?: string }>()
  private desired = new Map<MediaMarkKind, string | null>()
  private running = false
  private loading: Promise<void> | null = null
  private revision = 0
  private generation = 0
  private owner: string
  private artworkId: number
  private mediaId: number

  constructor(private client: QueryClient, identity: MediaMarkIdentity,
    private transport: MediaMarkTransport, initial?: MediaMarkStateDto) {
    const { owner, artworkId, mediaId } = identity
    this.owner = owner
    this.artworkId = artworkId
    this.mediaId = mediaId
    this.confirmed = initial ?? { markId: null, artworkId, mediaId, bookmarkedAt: null, likedAt: null, available: false }
    this.snapshot = { ...this.confirmed, isLoading: !initial, isSaving: false, error: null }
    if (initial) client.setQueryData(mediaMarkQueryKey(owner, artworkId, mediaId), initial)
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getSnapshot = () => this.snapshot

  private publish(error: Error | null = null) {
    this.snapshot = { ...this.confirmed, isLoading: false, isSaving: this.running, error }
    for (const [kind, value] of this.desired) this.snapshot[field(kind)] = value
    this.listeners.forEach((listener) => listener())
  }

  load = () => {
    if (this.loading || this.running || !this.transport.isCurrentAccount()) return this.loading ?? Promise.resolve()
    const revision = this.revision
    this.loading = this.client.fetchQuery({
      queryKey: mediaMarkQueryKey(this.owner, this.artworkId, this.mediaId),
      queryFn: ({ signal }) => this.transport.get(signal), staleTime: 15_000, retry: false
    }).then((state) => {
      if (revision !== this.revision || this.running || !this.transport.isCurrentAccount()) return
      this.confirmed = state
      this.publish()
    }).catch((error: unknown) => {
      if (revision === this.revision && this.transport.isCurrentAccount()) this.publish(error instanceof Error ? error : new Error('图片标记加载失败'))
    }).finally(() => { this.loading = null })
    return this.loading
  }

  set = (kind: MediaMarkKind, value: boolean) => {
    if (!this.transport.isCurrentAccount() || !this.snapshot.available || this.snapshot.isLoading) return
    if (Boolean(this.snapshot[field(kind)]) === value) return
    this.revision += 1
    this.pending.set(kind, { value })
    this.desired.set(kind, value ? this.snapshot[field(kind)] ?? new Date().toISOString() : null)
    this.running = true
    this.publish()
    void this.client.cancelQueries({ queryKey: mediaMarkQueryKey(this.owner, this.artworkId, this.mediaId), exact: true })
    if (this.pending.size === 1 && !this.draining) void this.drain()
  }

  deactivate = () => {
    this.revision += 1
    this.generation += 1
    this.pending.clear()
    this.desired.clear()
    this.running = false
    this.draining = false
    this.publish()
    void this.client.cancelQueries({ queryKey: mediaMarkQueryKey(this.owner, this.artworkId, this.mediaId), exact: true })
  }

  remove = (kind: MediaMarkKind, markId: string) => {
    if (!this.transport.isCurrentAccount()) return
    this.revision += 1
    this.pending.set(kind, { value: false, markId })
    this.desired.set(kind, null)
    this.running = true
    this.publish()
    void this.client.cancelQueries({ queryKey: mediaMarkQueryKey(this.owner, this.artworkId, this.mediaId), exact: true })
    if (!this.draining) void this.drain()
  }

  private draining = false
  private async drain() {
    this.draining = true
    const generation = this.generation
    const failures = new Map<MediaMarkKind, Error>()
    while (this.pending.size && this.transport.isCurrentAccount()) {
      const [kind, target] = this.pending.entries().next().value!
      this.pending.delete(kind)
      try {
        const state = target.markId
          ? await this.transport.remove(target.markId, kind).then(() => ({ ...this.confirmed, [field(kind)]: null }))
          : await this.transport.set(kind, target.value)
        if (generation !== this.generation) return
        if (!this.transport.isCurrentAccount()) break
        this.confirmed = state
        failures.delete(kind)
        if (!state.bookmarkedAt && !state.likedAt) this.confirmed.markId = null
      } catch (error: unknown) {
        if (generation !== this.generation) return
        if (!this.pending.has(kind)) failures.set(kind, error instanceof Error ? error : new Error('图片标记保存失败'))
      }
      if (!this.pending.has(kind)) this.desired.delete(kind)
      this.publish(failures.values().next().value ?? null)
    }
    this.pending.clear()
    this.desired.clear()
    this.running = false
    this.draining = false
    this.publish(failures.values().next().value ?? null)
    if (!this.transport.isCurrentAccount()) return
    this.client.setQueryData(mediaMarkQueryKey(this.owner, this.artworkId, this.mediaId), this.confirmed)
    try { await this.transport.onConfirmed() } catch { /* A refresh failure does not undo a saved mark. */ }
  }
}

const sessions = new WeakMap<QueryClient, Map<string, MediaMarkSession>>()
export function getMediaMarkSession(client: QueryClient, identity: MediaMarkIdentity,
  transport: MediaMarkTransport, initial?: MediaMarkStateDto) {
  const { owner, artworkId, mediaId } = identity
  let records = sessions.get(client)
  if (!records) sessions.set(client, records = new Map())
  const key = JSON.stringify([owner, artworkId, mediaId])
  let session = records.get(key)
  if (!session) {
    session = new MediaMarkSession(client, identity, transport, initial)
    records.set(key, session)
  }
  return session
}
