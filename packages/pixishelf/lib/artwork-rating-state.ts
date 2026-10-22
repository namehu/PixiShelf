import type { QueryClient } from '@tanstack/react-query'
import type { ArtworkRatingLevel, ArtworkRatingState } from '@/schemas/artwork-rating.dto'

export interface ArtworkRatingSnapshot {
  level: ArtworkRatingLevel
  confirmedLevel: ArtworkRatingLevel
  isLoading: boolean
  isSaving: boolean
  error: Error | null
}

export interface ArtworkRatingTransport {
  get: (signal: AbortSignal) => Promise<ArtworkRatingState>
  set: (level: ArtworkRatingLevel) => Promise<ArtworkRatingState>
  isCurrentAccount: () => boolean
  onConfirmed: (state: ArtworkRatingState) => Promise<void>
  onLoaded: (state: ArtworkRatingState) => void
}

export const artworkRatingQueryKey = (owner: string, artworkId: number) => ['artworkRating', owner, artworkId] as const

/** One account/artwork queue survives closing a dialog, changing slides, and client navigation. */
export class ArtworkRatingSession {
  private listeners = new Set<() => void>()
  private snapshot: ArtworkRatingSnapshot
  private confirmed: ArtworkRatingState
  private initialized: boolean
  private revision = 0
  private pending: { level: ArtworkRatingLevel } | null = null
  private running = false
  private loading: Promise<void> | null = null
  private failedTarget: { level: ArtworkRatingLevel } | null = null

  constructor(
    private client: QueryClient,
    private owner: string,
    private artworkId: number,
    private transport: ArtworkRatingTransport,
    initialLevel?: ArtworkRatingLevel
  ) {
    this.initialized = initialLevel !== undefined
    const level = initialLevel ?? null
    this.confirmed = { artworkId, level, isLike: level !== null && level >= 2, updatedAt: null }
    this.snapshot = { level, confirmedLevel: level, isLoading: !this.initialized, isSaving: false, error: null }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getSnapshot = () => this.snapshot

  private update(next: Partial<ArtworkRatingSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next }
    this.listeners.forEach((listener) => listener())
  }

  load = () => {
    // A second entrance can mount while a write is in flight. Its read could
    // observe the old database value yet finish after the write acknowledgement.
    // The shared queue already owns this state until all committed targets settle.
    if (this.loading || this.running || !this.transport.isCurrentAccount()) return this.loading ?? Promise.resolve()
    const revision = this.revision
    if (!this.initialized) this.update({ isLoading: true, error: null })
    this.loading = this.client.fetchQuery({
      queryKey: artworkRatingQueryKey(this.owner, this.artworkId),
      queryFn: ({ signal }) => this.transport.get(signal),
      staleTime: 0,
      retry: false
    }).then((state) => {
      // A read started before a gesture must never erase that gesture or its acknowledgement.
      if (revision !== this.revision || this.running) return
      this.initialized = true
      this.confirmed = state
      this.update({ level: state.level, confirmedLevel: state.level, isLoading: false, error: null })
      if (this.transport.isCurrentAccount()) this.transport.onLoaded(state)
    }).catch((error: unknown) => {
      if (revision === this.revision && !this.initialized) {
        this.update({ isLoading: false, error: error instanceof Error ? error : new Error('评分加载失败') })
      }
    }).finally(() => { this.loading = null })
    return this.loading
  }

  setLevel = (level: ArtworkRatingLevel) => {
    if (!this.transport.isCurrentAccount() || (level === this.snapshot.level && !this.snapshot.error)) return
    this.revision += 1
    this.failedTarget = null
    this.pending = { level }
    this.update({ level, isLoading: false, isSaving: true, error: null })
    void this.client.cancelQueries({ queryKey: artworkRatingQueryKey(this.owner, this.artworkId), exact: true })
    if (!this.running) void this.drain()
  }

  retry = () => {
    if (this.failedTarget) this.setLevel(this.failedTarget.level)
    else void this.load()
  }

  deactivate = () => {
    this.revision += 1
    this.pending = null
    this.failedTarget = null
    this.update({ level: this.confirmed.level, confirmedLevel: this.confirmed.level, isLoading: false, isSaving: false, error: null })
    void this.client.cancelQueries({ queryKey: artworkRatingQueryKey(this.owner, this.artworkId), exact: true })
  }

  private async publish() {
    // A failed cache refresh does not turn a successfully persisted rating into a failed write.
    try { await this.transport.onConfirmed(this.confirmed) } catch { /* Queries retry on their next mount. */ }
  }

  private async drain() {
    this.running = true
    while (this.pending) {
      const target = this.pending
      this.pending = null
      if (!this.transport.isCurrentAccount()) {
        this.update({ level: this.confirmed.level, confirmedLevel: this.confirmed.level, isSaving: false })
        break
      }
      try {
        this.confirmed = await this.transport.set(target.level)
        this.initialized = true
      } catch (error: unknown) {
        if (this.pending) continue
        this.failedTarget = target
        this.update({
          level: this.confirmed.level, confirmedLevel: this.confirmed.level, isSaving: false,
          error: error instanceof Error ? error : new Error('评分保存失败')
        })
        await this.publish()
        continue
      }
      // Keep the newest optimistic value visible while an earlier write finishes.
      if (this.pending && this.transport.isCurrentAccount()) {
        this.update({ confirmedLevel: this.confirmed.level })
        continue
      }
      this.pending = null
      this.update({ level: this.confirmed.level, confirmedLevel: this.confirmed.level, isSaving: false, error: null })
      await this.publish()
    }
    this.running = false
  }
}

const sessions = new WeakMap<QueryClient, Map<string, ArtworkRatingSession>>()

export function getArtworkRatingSession(
  client: QueryClient, owner: string, artworkId: number, transport: ArtworkRatingTransport, initialLevel?: ArtworkRatingLevel
) {
  let records = sessions.get(client)
  if (!records) sessions.set(client, records = new Map())
  const key = JSON.stringify([owner, artworkId])
  let session = records.get(key)
  if (!session) {
    session = new ArtworkRatingSession(client, owner, artworkId, transport, initialLevel)
    records.set(key, session)
  }
  return session
}
