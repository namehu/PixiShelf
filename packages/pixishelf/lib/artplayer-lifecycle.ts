import type Artplayer from 'artplayer'
import { bindFullscreenWebHistory } from '@/lib/artplayer-fullscreen-history'

/**
 * 为 ArtPlayer 实例创建可重复调用的清理函数。
 *
 * 网页全屏时 ArtPlayer 会把根元素移出 React 管理的容器，组件卸载时 React 无法自动移除该元素，
 * 因此销毁流程必须同时处理播放器实例和遗留 DOM。
 */
export function createArtplayerCleanup(player: Artplayer, container: HTMLElement): () => void {
  const playerElement = container.querySelector<HTMLElement>('.art-video-player')
  const unbindFullscreenWebHistory = bindFullscreenWebHistory(player)
  let destroyed = false

  const exitWebFullscreen = () => {
    if (destroyed) {
      return
    }

    try {
      if (player.fullscreenWeb) {
        player.fullscreenWeb = false
      }
    } catch {
      // 退出全屏失败也继续销毁，并由下方 DOM 兜底清理。
    }
  }

  const handlePageHide = () => {
    unbindFullscreenWebHistory()
    exitWebFullscreen()
  }

  window.addEventListener('pagehide', handlePageHide)

  return () => {
    window.removeEventListener('pagehide', handlePageHide)
    unbindFullscreenWebHistory()

    if (destroyed) {
      return
    }

    exitWebFullscreen()
    destroyed = true

    try {
      player.destroy(true)
    } catch {
      // ArtPlayer 销毁失败时，下方仍会直接移除实例根元素。
    } finally {
      if (playerElement?.isConnected) {
        playerElement.remove()
      }
      container.replaceChildren()
    }
  }
}
