import type Artplayer from 'artplayer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createChapterOverlayPlugin,
  type ChapterOverlayPortal
} from '../artplayer-chapter-overlay-plugin'
import type { NormalizedChapter } from '../video-chapters'

const chapters: NormalizedChapter[] = [
  {
    id: 'chapter-1',
    index: 1,
    title: 'Opening',
    start: 0,
    end: 10,
    duration: 10,
    previewStatus: 'PENDING',
    previewUrl: null,
    previewCaptureTime: null,
    previewUpdatedAt: null
  },
  {
    id: 'chapter-2',
    index: 2,
    title: 'Ending',
    start: 10,
    end: 20,
    duration: 10,
    previewStatus: 'PENDING',
    previewUrl: null,
    previewCaptureTime: null,
    previewUpdatedAt: null
  }
]

function createArtplayerStub() {
  const player = document.createElement('div')
  player.className = 'art-video-player'
  const layerRoot = document.createElement('div')
  layerRoot.className = 'art-layers'
  player.append(layerRoot)
  document.body.append(player)

  const video = {
    paused: false,
    ended: false,
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined)
  } as unknown as HTMLVideoElement
  const layerCache = new Map<
    string,
    {
      element: HTMLElement
      beforeUnmount?: (element: HTMLElement) => void
    }
  >()

  const layers = {
    add: vi.fn(
      (option: {
        name: string
        style?: Partial<CSSStyleDeclaration>
        mounted?: (element: HTMLElement) => void
        beforeUnmount?: (element: HTMLElement) => void
      }) => {
        const element = document.createElement('div')
        Object.assign(element.style, option.style)
        layerRoot.append(element)
        layerCache.set(option.name, { element, beforeUnmount: option.beforeUnmount })
        Object.assign(layers, { [option.name]: element })
        option.mounted?.(element)
        return element
      }
    ),
    remove: vi.fn((name: string) => {
      const layer = layerCache.get(name)
      if (!layer) return
      layer.beforeUnmount?.(layer.element)
      layer.element.remove()
      layerCache.delete(name)
      delete (layers as Record<string, unknown>)[name]
    })
  }

  const art = {
    currentTime: 0,
    duration: 20,
    video,
    template: { $player: player, $video: video },
    layers
  } as unknown as Artplayer

  return { art, layerRoot, layers, player, video }
}

describe('ArtPlayer chapter overlay plugin', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.style.overflow = ''
    document.body.replaceChildren()
  })

  it('keeps its layer inside the player when web fullscreen moves the player to body', () => {
    vi.useFakeTimers()
    const renderPortal = vi.fn<(portal: ChapterOverlayPortal) => void>()
    const { art, layerRoot, layers, player } = createArtplayerStub()
    const api = createChapterOverlayPlugin(renderPortal)(art)
    const portal = renderPortal.mock.calls.at(-1)?.[0]

    expect(portal?.target.parentElement).toBe(layerRoot)

    api.update({ chapters, currentChapterId: 'chapter-1', mode: 'desktop' })
    api.show()
    expect(api.visible).toBe(true)
    expect(player.classList.contains('pixishelf-chapter-overlay-open')).toBe(true)

    document.body.append(player)
    expect(player.contains(portal!.target)).toBe(true)

    const playerClick = vi.fn()
    player.addEventListener('click', playerClick)
    portal!.target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(playerClick).not.toHaveBeenCalled()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(api.visible).toBe(false)
    vi.advanceTimersByTime(180)
    expect(player.classList.contains('pixishelf-chapter-overlay-open')).toBe(false)

    api.destroy()
    api.destroy()
    expect(layers.remove).toHaveBeenCalledTimes(1)
    expect(player.contains(portal!.target)).toBe(false)
  })

  it('pauses and restores mobile playback but does not resume while destroying', () => {
    const renderPortal = vi.fn<(portal: ChapterOverlayPortal) => void>()
    const { art, video } = createArtplayerStub()
    const api = createChapterOverlayPlugin(renderPortal)(art)
    document.body.style.overflow = 'clip'

    api.update({ chapters, currentChapterId: 'chapter-1', mode: 'mobile' })
    api.show()
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(document.body.style.overflow).toBe('hidden')

    api.hide()
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(document.body.style.overflow).toBe('clip')

    api.show()
    api.destroy()
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(document.body.style.overflow).toBe('clip')
  })

  it('refuses to open without chapters and closes when chapters are cleared', () => {
    const renderPortal = vi.fn<(portal: ChapterOverlayPortal) => void>()
    const { art } = createArtplayerStub()
    const api = createChapterOverlayPlugin(renderPortal)(art)

    api.show()
    expect(api.visible).toBe(false)

    api.update({ chapters, currentChapterId: 'chapter-1', mode: 'desktop' })
    api.show()
    expect(api.visible).toBe(true)

    api.update({ chapters: [], currentChapterId: undefined, mode: 'desktop' })
    expect(api.visible).toBe(false)
    api.destroy()
  })
})
