import { MEDIA_INDEX_CONFLICT, MEDIA_PAGE_SIZE, type MediaIndex, type MediaPage } from '@/schemas/artwork-reader.dto'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'

/** A reader session owns its requests; UI unmounts release pins, not other readers' pages. */
export class MediaPageStore {
  private pages = new Map<number, MediaPage>()
  private requested = new Map<string, Set<number>>()
  private loading = new Set<number>()
  private errors = new Set<number>()
  private listeners = new Set<() => void>()
  private revision = 0
  private disposed = false
  invalidated = false
  constructor(readonly index: MediaIndex, private fetchPage: (page: number) => Promise<MediaPage>, seed?: MediaPage) {
    if (seed?.fingerprint === index.fingerprint) this.pages.set(seed.page, seed)
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.revision
  private emit() { this.revision++; this.listeners.forEach((listener) => listener()) }
  get(mediaId: number, index: number): ArtworkImageResponseDto | undefined {
    return this.pages.get(Math.floor(index / MEDIA_PAGE_SIZE))?.images.find((media) => media.id === mediaId)
  }
  failed(index: number) { return this.errors.has(Math.floor(index / MEDIA_PAGE_SIZE)) }
  request(owner: string, indexes: number[]) {
    const pages = new Set(indexes.filter((index) => index >= 0 && index < this.index.items.length).map((index) => Math.floor(index / MEDIA_PAGE_SIZE)))
    this.requested.set(owner, pages)
    this.evict()
    this.pump()
  }
  release(owner: string) { this.requested.delete(owner); this.evict(); this.pump() }
  retry() { this.errors.clear(); this.emit(); this.pump() }
  activate() { this.disposed = false; this.pump() }
  dispose() { this.disposed = true; this.listeners.clear() }
  private wanted() { return new Set([...new Set([...this.requested.values()].flatMap((pages) => [...pages]))].slice(0, 8)) }
  private evict() {
    const wanted = this.wanted()
    for (const page of wanted) {
      const value = this.pages.get(page)
      if (value) { this.pages.delete(page); this.pages.set(page, value) }
    }
    while (this.pages.size > 8) {
      const victim = [...this.pages.keys()].find((page) => !wanted.has(page))
      if (victim === undefined) break
      this.pages.delete(victim)
    }
  }
  private pump() {
    if (this.disposed || this.invalidated) return
    for (const page of this.wanted()) {
      if (this.loading.size >= 2) break
      if (this.pages.has(page) || this.loading.has(page) || this.errors.has(page)) continue
      this.loading.add(page)
      void this.fetchPage(page).then((result) => {
        if (result.fingerprint !== this.index.fingerprint) { this.invalidated = true; return }
        this.pages.set(page, result)
        this.evict()
      }).catch((error: unknown) => {
        if (error instanceof Error && error.message.includes(MEDIA_INDEX_CONFLICT)) this.invalidated = true
        else this.errors.add(page)
      }).finally(() => {
        this.loading.delete(page)
        if (!this.disposed) { this.emit(); this.pump() }
      })
    }
  }
}
