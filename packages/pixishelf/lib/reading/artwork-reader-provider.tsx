'use client'

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthUser } from '@/components/auth/auth-provider'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { MEDIA_PAGE_SIZE, type MediaIndexItem, type ReaderInitialPage } from '@/schemas/artwork-reader.dto'
import { useArtworkReading } from './reading-provider'
import { MediaPageStore } from './media-page-store'

// These are layout-only client slots. Empty paths never reach a media renderer.
function placeholder(item: MediaIndexItem, artworkId: number): ArtworkImageResponseDto {
  return {
    id: item.mediaId, artworkId, path: '', width: item.width, height: item.height, size: null,
    sortOrder: item.index, createdAt: '', updatedAt: '', mediaType: item.mediaType,
    isAnimated: item.isAnimated, webpAnimationStatus: item.reliableDimensions ? null : 0,
    animationMetadata: null, chaptersPath: null, chaptersCount: 0, chaptersDuration: null,
    chaptersUpdatedAt: null, chaptersHash: null, hasChapters: false, detailsPending: true,
    reliableDimensions: item.reliableDimensions
  }
}
const ReaderContext = createContext<ReturnType<typeof useReaderSession> | null>(null)
const noopSubscribe = () => () => {}
const zero = () => 0

function useReaderSession(artworkId: number, initial?: ReaderInitialPage) {
  const owner = useAuthUser()?.id
  const trpc = useTRPC()
  const client = useTRPCClient()
  const queryOptions = trpc.artwork.reader.queryOptions(
    { artworkId, expectedUserId: owner ?? '' }
  )
  // A new SSR snapshot must not consume an older visit's cached index while it refetches.
  const query = useQuery({
    queryKey: [...queryOptions.queryKey, { fingerprint: initial?.fingerprint ?? null }],
    queryFn: ({ signal }) => client.artwork.reader.query({ artworkId, expectedUserId: owner ?? '' }, { signal }),
    enabled: Boolean(owner && artworkId > 0), staleTime: 0, refetchOnWindowFocus: false
  })
  const initialization = query.data
  const store = useMemo(() => initialization && owner ? new MediaPageStore(initialization.index, (page) =>
    client.artwork.mediaPage.query({ artworkId, expectedUserId: owner, fingerprint: initialization.index.fingerprint, page }),
  initial ? { fingerprint: initial.fingerprint, page: 0, images: initial.artwork.images } : undefined) : null,
  [artworkId, owner, client, initialization?.index.fingerprint, initial])
  useEffect(() => { store?.activate(); return () => store?.dispose() }, [store])
  const revision = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.snapshot ?? zero, zero)
  const mismatch = Boolean(initial && initialization && initial.fingerprint !== initialization.index.fingerprint)
  const mediaConflict = Boolean(store?.invalidated || mismatch || (initialization && initialization.reading.mediaRevision !== initialization.index.mediaRevision))
  const readingContext = useMemo(() => initialization ? { ...initialization.reading,
    media: initialization.index.items.map(({ mediaId, memberMediaIds, index, mediaType }) => ({ mediaId, memberMediaIds, index, isVideo: mediaType === 'video' }))
  } : undefined, [initialization])
  const reading = useArtworkReading(artworkId, { external: true, context: mediaConflict ? undefined : readingContext, isLoading: query.isLoading, error: query.error, retry: query.refetch })
  useEffect(() => { if (mediaConflict) reading.invalidate() }, [mediaConflict, reading.invalidate])
  const images = useMemo(() => initialization && store
    ? initialization.index.items.map((item) => store.get(item.mediaId, item.index) ?? placeholder(item, artworkId))
    : initial?.artwork.images ?? [], [initialization, store, revision, artworkId, initial])
  return { images, reading, store, initialization, total: initialization?.index.items.length ?? initial?.total ?? 0,
    title: initialization?.title ?? initial?.artwork.title ?? '', isLoading: query.isLoading, error: query.error,
    retry: query.refetch, invalidated: Boolean(mediaConflict || reading.invalidated) }
}

export function ArtworkReaderProvider({ artworkId, initial, children }: React.PropsWithChildren<{ artworkId: number; initial?: ReaderInitialPage }>) {
  const value = useReaderSession(artworkId, initial)
  return <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>
}
export function useArtworkReader() { return useContext(ReaderContext) }

/** Indexes are resolved by identity so filtered readers still request original pages. */
export function useReaderMediaWindow(owner: string, mediaIds: number[], enabled = true) {
  const reader = useArtworkReader()
  const store = reader?.store
  const invalidated = reader?.invalidated
  const key = mediaIds.join(',')
  useEffect(() => {
    if (!store || !enabled || invalidated) return
    const byId = new Map(store.index.items.map((item) => [item.mediaId, item.index]))
    const indexes = key.split(',').map(Number).flatMap((id) => {
      const index = byId.get(id)
      return index === undefined ? [] : [index]
    })
    // Prefetch one batch after the final requested item, without walking from page zero.
    const last = indexes.at(-1)
    store.request(owner, last === undefined ? indexes : [...indexes, (Math.floor(last / MEDIA_PAGE_SIZE) + 1) * MEDIA_PAGE_SIZE])
    return () => store.release(owner)
  }, [store, owner, key, enabled, invalidated])
}

export function MediaDetailsPlaceholder({ media, index, fill = false }: { media: ArtworkImageResponseDto; index: number; fill?: boolean }) {
  const reader = useArtworkReader()
  const original = reader?.initialization?.index.items.find((item) => item.mediaId === media.id)?.index ?? index
  const failed = reader?.store?.failed(original)
  return <div className={fill ? 'flex h-full w-full items-center justify-center bg-muted text-muted-foreground' : 'flex w-full items-center justify-center bg-muted text-muted-foreground'}
    style={fill ? undefined : media.reliableDimensions && media.width && media.height
      ? { aspectRatio: `${media.width} / ${media.height}` } : { height: 'clamp(300px, 60vw, 500px)' }}
    data-preview-status={failed ? 'error' : 'loading'} data-auto-media-id={media.id} aria-busy={!failed}>
    {failed ? <button className="min-h-11 px-4 text-sm underline" onClick={() => reader?.store?.retry()}>加载失败，重试</button>
      : <span className="text-sm" role="status">正在加载第 {original + 1} 张…</span>}
  </div>
}
