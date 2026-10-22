'use client'

import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { isWebpFile } from '@/lib/media'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { useArtworkSummary } from './artwork-summary-context'
import { useArtworkSlideshow } from './use-artwork-slideshow'

export function useArtworkStackSlideshow({ images, containerRef, enabled }: {
  images: ArtworkImageResponseDto[]
  containerRef: RefObject<HTMLDivElement | null>
  enabled: boolean
}) {
  const summary = useArtworkSummary()
  const currentId = useArtworkAutoBrowseStore((state) => state.currentMediaId)
  const running = useArtworkAutoBrowseStore((state) => state.mode === 'slideshow' && ['running', 'waiting'].includes(state.status))
  const previewOpen = useArtworkAutoBrowseStore((state) => state.previewOpen)
  const skipped = useArtworkAutoBrowseStore((state) => currentId !== null && state.skippedIds.includes(currentId))
  const index = Math.max(0, images.findIndex((media) => media.id === currentId))
  const media = images[index]
  const active = enabled && !previewOpen
  const [surface, setSurface] = useState({ id: -1, status: 'loading', transitioning: true })
  useEffect(() => {
    if (!active || !running || !media) return
    const state = useArtworkAutoBrowseStore.getState()
    if (state.currentMediaId !== media.id) state.setCurrentMedia(media.id)
    const group = summary?.byMediaId.get(media.id)
    if (group && summary?.activeByGroup.get(group.id) !== media.id) summary?.selectMedia(media.id)
  }, [active, running, media, summary?.activeByGroup, summary?.byMediaId, summary?.selectMedia])
  useEffect(() => {
    if (!active || !media || !containerRef.current) return
    const root = containerRef.current
    const update = () => {
      const element = root.querySelector<HTMLElement>(`[data-auto-media-id="${media.id}"]`)
      const next = { id: media.id, status: element?.dataset.previewStatus ?? 'loading',
        transitioning: !element || element.closest<HTMLElement>('[data-stack-transitioning]')?.dataset.stackTransitioning === 'true' }
      setSurface((prior) => prior.id === next.id && prior.status === next.status && prior.transitioning === next.transitioning ? prior : next)
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-preview-status', 'data-stack-transitioning', 'data-auto-media-id'] })
    return () => observer.disconnect()
  }, [active, media?.id, containerRef])
  useEffect(() => {
    if (active && running && media?.mediaType === 'video' && !skipped && !summary?.navigating) {
      useArtworkAutoBrowseStore.getState().pause('video')
    }
  }, [active, running, media, skipped, summary?.navigating])
  const go = useCallback((target: ArtworkImageResponseDto | undefined) => {
    if (!target) return
    const prior = summary?.byMediaId.get(currentId ?? -1)
    const next = summary?.byMediaId.get(target.id)
    useArtworkAutoBrowseStore.getState().setCurrentMedia(target.id)
    if (prior?.id === next?.id) summary?.selectMedia(target.id)
    else summary?.reveal(target.id)
  }, [currentId, summary?.byMediaId, summary?.selectMedia, summary?.reveal])
  const onNext = useCallback(() => go(images[index + 1]), [go, images, index])
  const onFirst = useCallback(() => go(images[0]), [go, images])
  useArtworkSlideshow({ index, count: images.length, mediaId: media?.id,
    ready: surface.id === media?.id && surface.status === 'ready', error: surface.id === media?.id && surface.status === 'error',
    transitioning: surface.id !== media?.id || surface.transitioning || Boolean(summary?.navigating),
    blocked: false, enabled: active && (media?.mediaType !== 'video' || skipped),
    animated: Boolean(media && isWebpFile(media.path) && media.isAnimated), onNext, onFirst })
}
