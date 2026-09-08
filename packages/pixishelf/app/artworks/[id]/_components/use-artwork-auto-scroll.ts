'use client'

import { useEffect, type RefObject } from 'react'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { isVideoFile } from '@/lib/media'

export function getAutoBrowseViewport() {
  const toolbar = document.querySelector('.artwork-detail-toolbar')?.getBoundingClientRect()
  const top = Math.max(0, toolbar?.bottom ?? 0)
  let bottom = window.innerHeight
  for (const element of document.querySelectorAll('[aria-label="手机主导航"], [data-auto-scroll-bar]')) {
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) bottom = Math.min(bottom, rect.top - 8)
  }
  return { top, bottom: Math.max(top + 1, bottom) }
}

export function useArtworkAutoScroll({
  containerRef,
  images,
  expanded,
  expand
}: {
  containerRef: RefObject<HTMLDivElement | null>
  images: ArtworkImageResponseDto[]
  expanded: boolean
  expand: () => void
}) {
  const active = useArtworkAutoBrowseStore(
    (state) =>
      state.mode === 'scroll' && !state.previewOpen && (state.status === 'running' || state.status === 'waiting')
  )
  const revision = useArtworkAutoBrowseStore((state) => state.revision)

  useEffect(() => {
    if (!active) return
    if (!expanded) {
      expand()
      return
    }
    const store = useArtworkAutoBrowseStore
    const session = store.getState().session
    let frame = 0
    let previousTime: number | null = null
    let position = window.scrollY
    let atEndSince: number | null = null
    let firstFrame = true
    const tick = (time: number) => {
      const state = store.getState()
      if (
        state.session !== session ||
        state.revision !== revision ||
        state.mode !== 'scroll' ||
        state.previewOpen ||
        !['running', 'waiting'].includes(state.status)
      ) {
        return
      }
      const container = containerRef.current
      if (!container) return
      const { top, bottom } = getAutoBrowseViewport()
      const bounds = container.getBoundingClientRect()
      if (firstFrame && (bounds.top > top || bounds.bottom <= top)) {
        position = Math.max(0, bounds.top + window.scrollY - top)
        window.scrollTo({ top: position, behavior: 'instant' })
        firstFrame = false
        frame = requestAnimationFrame(tick)
        return
      }
      firstFrame = false
      const delta = previousTime === null ? 0 : Math.min(64, Math.max(0, time - previousTime))
      previousTime = time
      const nodes = Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-index]'))
      const visible = nodes.filter((node) => {
        const rect = node.getBoundingClientRect()
        return rect.bottom > top && rect.top < bottom
      })
      const focus = (top + bottom) / 2
      const current =
        visible.find((node) => {
          const rect = node.getBoundingClientRect()
          return rect.top <= focus && rect.bottom > focus
        }) ?? visible[0]
      const currentIndex = current ? Number(current.dataset.index) : -1
      const currentMedia = images[currentIndex]
      if (currentMedia) state.setCurrentMedia(currentMedia.id)

      if (
        currentMedia &&
        (currentMedia.mediaType === 'video' || isVideoFile(currentMedia.path)) &&
        !state.skippedIds.includes(currentMedia.id)
      ) {
        state.pause('video')
        return
      }
      // Wait for visible previews, not the whole collection; offscreen media stays lazy.
      const pending = visible.find((node) => {
        const media = images[Number(node.dataset.index)]
        return (
          media &&
          media.mediaType !== 'video' &&
          !isVideoFile(media.path) &&
          !state.skippedIds.includes(media.id) &&
          node.querySelector('[data-preview-status]')?.getAttribute('data-preview-status') !== 'ready'
        )
      })
      if (pending) {
        const media = images[Number(pending.dataset.index)]!
        state.setCurrentMedia(media.id)
        const failed = pending.querySelector('[data-preview-status]')?.getAttribute('data-preview-status') === 'error'
        if (failed) {
          state.pause('error')
          return
        }
        state.wait()
        position = window.scrollY
        frame = requestAnimationFrame(tick)
        return
      }
      state.ready()
      const last = nodes.find((node) => Number(node.dataset.index) === images.length - 1)
      if (last && last.getBoundingClientRect().bottom <= bottom + 1) {
        if (!state.loop) {
          state.end()
          return
        }
        atEndSince ??= time
        if (time - atEndSince >= 2000) {
          state.resetCycle()
          position = Math.max(0, bounds.top + window.scrollY - top)
          window.scrollTo({ top: position, behavior: 'instant' })
          atEndSince = null
          previousTime = null
        }
      } else {
        atEndSince = null
        if (Math.abs(position - window.scrollY) > 2) position = window.scrollY
        const end = Math.max(0, bounds.bottom + window.scrollY - bottom)
        position = Math.min(end, position + (state.scrollSpeed * delta) / 1000)
        window.scrollTo({ top: position, behavior: 'instant' })
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, containerRef, expand, expanded, images, revision])
}
