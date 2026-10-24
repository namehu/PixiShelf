import { afterEach, describe, expect, it, vi } from 'vitest'
import type Artplayer from 'artplayer'
import { toggleVideoFullscreen } from '../video-fullscreen'

function fixture() {
  const player = document.createElement('div')
  const video = document.createElement('video')
  const nativeVideoFullscreen = vi.fn()
  Object.assign(video, { webkitEnterFullscreen: nativeVideoFullscreen })
  player.append(video)
  document.body.append(player)
  const art = {
    template: { $player: player, $video: video } as Artplayer['template'],
    fullscreenWeb: false
  }
  return { art, player, nativeVideoFullscreen }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setDocumentProperty(name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(document, name)
  Object.defineProperty(document, name, { configurable: true, value })
  return () => {
    if (original) Object.defineProperty(document, name, original)
    else Reflect.deleteProperty(document, name)
  }
}

describe('video container fullscreen', () => {
  it('uses the entire player, preserving custom controls, and exits on a second click', async () => {
    const { art, player, nativeVideoFullscreen } = fixture()
    const request = vi.fn().mockResolvedValue(undefined)
    const exit = vi.fn().mockResolvedValue(undefined)
    player.requestFullscreen = request
    const restore = [setDocumentProperty('fullscreenEnabled', true), setDocumentProperty('exitFullscreen', exit)]
    try {
      await toggleVideoFullscreen(art)
      expect(request).toHaveBeenCalledOnce()
      expect(art.fullscreenWeb).toBe(false)
      restore.push(setDocumentProperty('fullscreenElement', player))
      await toggleVideoFullscreen(art)
      expect(exit).toHaveBeenCalledOnce()
      expect(nativeVideoFullscreen).not.toHaveBeenCalled()
    } finally {
      restore.reverse().forEach((fn) => fn())
    }
  })

  it('falls back to web fullscreen on video-only mobile browsers', async () => {
    const { art, nativeVideoFullscreen } = fixture()
    await toggleVideoFullscreen(art)
    expect(art.fullscreenWeb).toBe(true)
    expect(nativeVideoFullscreen).not.toHaveBeenCalled()
    await toggleVideoFullscreen(art)
    expect(art.fullscreenWeb).toBe(false)
  })

  it('supports prefixed container fullscreen', async () => {
    const { art, player } = fixture()
    const request = vi.fn()
    const exit = vi.fn()
    Object.assign(player, { webkitRequestFullscreen: request })
    const restore = [
      setDocumentProperty('webkitFullscreenEnabled', true),
      setDocumentProperty('webkitExitFullscreen', exit)
    ]
    try {
      await toggleVideoFullscreen(art)
      expect(request).toHaveBeenCalledOnce()
      restore.push(setDocumentProperty('webkitFullscreenElement', player))
      await toggleVideoFullscreen(art)
      expect(exit).toHaveBeenCalledOnce()
    } finally {
      restore.reverse().forEach((fn) => fn())
    }
  })

  it.each([true, false])(
    'handles rejected fullscreen without reviving an unmounted player (connected=%s)',
    async (connected) => {
      const { art, player } = fixture()
      player.requestFullscreen = vi.fn().mockRejectedValue(new Error('denied'))
      const restore = setDocumentProperty('fullscreenEnabled', true)
      if (!connected) player.remove()
      try {
        await toggleVideoFullscreen(art)
        expect(art.fullscreenWeb).toBe(connected)
      } finally {
        restore()
      }
    }
  )
})
