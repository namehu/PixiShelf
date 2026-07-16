import type Artplayer from 'artplayer'
import { bindFullscreenWebHistory } from '@/lib/artplayer-fullscreen-history'

/**
 * Creates an idempotent cleanup function for an ArtPlayer instance.
 *
 * ArtPlayer moves its root element outside the React-owned container while in
 * web fullscreen mode, so React cannot remove that element during unmount.
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
      // Continue with destruction and the DOM fallback below.
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
      // The instance root is removed below if ArtPlayer destruction fails.
    } finally {
      if (playerElement?.isConnected) {
        playerElement.remove()
      }
      container.replaceChildren()
    }
  }
}
