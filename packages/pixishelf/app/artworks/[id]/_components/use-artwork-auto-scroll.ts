'use client'

import { useEffect, type RefObject } from 'react'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { isVideoFile, isWebpFile } from '@/lib/media'
import { isConfirmedStaticWebp } from '@/lib/media-animation'

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
  const ownerSession = useArtworkAutoBrowseStore((state) => state.session)

  useEffect(
    () => () => {
      const state = useArtworkAutoBrowseStore.getState()
      if (state.session === ownerSession && state.mode === 'scroll') state.setActiveAnimation(null)
    },
    [ownerSession]
  )

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
    let animation: { id: number } | null = null
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
      // 按阅读顺序优先选择目标，避免视口中心上方的短动图被直接略过。
      const animationNode =
        visible.find((node) => images[Number(node.dataset.index)]?.id === state.activeAnimationId) ??
        visible.find((node) => {
          const media = images[Number(node.dataset.index)]
          return (
            media &&
            isWebpFile(media.path) &&
            media.isAnimated &&
            !isConfirmedStaticWebp(media) &&
            !state.skippedIds.includes(media.id) &&
            !state.completedAnimationIds.includes(media.id) &&
            !state.stoppedAnimationIds.includes(media.id) &&
            (node.getBoundingClientRect().top <= focus || bounds.bottom <= bottom + 1)
          )
        })
      const current =
        animationNode ??
        visible.find((node) => {
          const rect = node.getBoundingClientRect()
          return rect.top <= focus && rect.bottom > focus
        }) ??
        visible[0]
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
      // 只等待当前可见预览，屏外媒体仍保持懒加载，不阻塞滚动进度。
      const pending = visible.find((node) => {
        // 不让相邻预览的加载或失败打断当前动图播放。
        if (animationNode && node !== animationNode) return false
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
      if (animationNode) {
        const media = images[Number(animationNode.dataset.index)]!
        state.setCurrentMedia(media.id)
        if (animation?.id !== media.id) {
          animation = { id: media.id }
          const rect = animationNode.getBoundingClientRect()
          position = Math.max(0, window.scrollY + rect.top - top - Math.max(0, (bottom - top - rect.height) / 2))
          window.scrollTo({ top: position, behavior: 'instant' })
          state.setActiveAnimation(media.id)
          state.wait()
        } else if (state.animationPhase === 'playing') {
          state.ready()
        } else {
          state.wait()
        }
        position = window.scrollY
        frame = requestAnimationFrame(tick)
        return
      }
      if (animation) {
        if (state.activeAnimationId !== null) {
          state.pause('manual')
          return
        }
        state.setActiveAnimation(null)
        animation = null
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
    return () => {
      // 调度取消不等于播放销毁：暂停/设置变更仍需保留当前帧。
      cancelAnimationFrame(frame)
    }
  }, [active, containerRef, expand, expanded, images, revision])
}
