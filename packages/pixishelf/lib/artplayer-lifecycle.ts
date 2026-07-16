import type Artplayer from 'artplayer'

/**
 * Creates an idempotent cleanup function for an ArtPlayer instance.
 *
 * ArtPlayer moves its root element outside the React-owned container while in
 * web fullscreen mode, so React cannot remove that element during unmount.
 */
export function createArtplayerCleanup(player: Artplayer, container: HTMLElement): () => void {
  const playerElement = container.querySelector<HTMLElement>('.art-video-player')
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
    exitWebFullscreen()
  }

  window.addEventListener('pagehide', handlePageHide)

  return () => {
    window.removeEventListener('pagehide', handlePageHide)

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
