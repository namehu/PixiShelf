'use client'

import { useEffect, type RefObject } from 'react'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { getAutoBrowseViewport } from './use-artwork-auto-scroll'

/** 以扣除工具栏后的阅读视口统一选择播放对象，避免虚拟列表中多个已挂载视频抢播。 */
export function useArtworkVideoPlayback(root: RefObject<HTMLDivElement | null>) {
  const previewOpen = useArtworkAutoBrowseStore((state) => state.previewOpen)
  const animationActive = useArtworkAutoBrowseStore((state) => state.activeAnimationId !== null)
  useEffect(() => {
    const element = root.current
    if (!element) return
    let frame = 0
    const update = () => {
      frame = 0
      const store = useArtworkAutoBrowseStore.getState()
      if (document.hidden || previewOpen || animationActive) {
        store.setActiveVideo(null)
        return
      }
      const { top, bottom } = getAutoBrowseViewport()
      const center = (top + bottom) / 2
      // 先在所有媒体中选离阅读中心最近的一项；当前读的是图片时，不播放旁边的视频。
      const candidates = Array.from(element.querySelectorAll<HTMLElement>('[data-auto-media-id]'))
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.bottom > top && rect.top < bottom)
        .sort((a, b) => {
          const distance = (rect: DOMRect) => Math.max(rect.top - center, center - rect.bottom, 0)
          return distance(a.rect) - distance(b.rect)
        })
      const current = candidates[0]?.node
      store.setActiveVideo(current?.dataset.videoMedia === 'true' ? Number(current.dataset.autoMediaId) : null)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const visibility = () => {
      // 后台标签页的动画帧可能被挂起，隐藏时直接撤销播放资格，不等待下一帧。
      if (document.hidden) useArtworkAutoBrowseStore.getState().setActiveVideo(null)
      else schedule()
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(element)
    // 虚拟列表挂载/卸载媒体不一定触发 scroll，同样需要重新计算当前项。
    const mutation = new MutationObserver(schedule)
    mutation.observe(element, { childList: true, subtree: true })
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    document.addEventListener('visibilitychange', visibility)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('visibilitychange', visibility)
      useArtworkAutoBrowseStore.getState().setActiveVideo(null)
    }
  }, [root, previewOpen, animationActive])
}
