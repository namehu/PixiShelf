import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourcePreviewThumbnail } from '../source-preview-thumbnail'

let resize: ((entries: Array<{ contentRect: { width: number; height: number } }>) => void) | null = null
const drawImage = vi.fn()
const clearRect = vi.fn()

class ResizeObserverMock {
  constructor(callback: typeof resize) {
    resize = callback
  }
  observe() {}
  disconnect() {}
}

describe('SourcePreviewThumbnail', () => {
  beforeEach(() => {
    resize = null
    drawImage.mockReset()
    clearRect.mockReset()
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, clearRect } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('uses a direct native image with browser lazy loading and no referrer', () => {
    render(
      <SourcePreviewThumbnail
        item={{ ordinal: 0, url: 'https://t.example.test/thumb.jpg', width: 240, height: 360 }}
        alt="来源缩略图 1"
      />
    )
    const image = screen.getByAltText('来源缩略图 1')
    expect(image.getAttribute('src')).toBe('https://t.example.test/thumb.jpg')
    expect(image.getAttribute('loading')).toBe('lazy')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(image.closest('[data-source-preview-crop]')).toBeNull()
  })

  it('clips a list sprite and sizes it from untransformed layout dimensions', () => {
    const { container } = render(
      <SourcePreviewThumbnail
        item={{
          ordinal: 4,
          url: 'https://t.example.test/sprite.jpg',
          width: 300,
          height: 150,
          crop: { x: 120, y: 40, width: 300, height: 150 }
        }}
        alt="来源缩略图 5"
        eager
      />
    )
    const frame = container.querySelector('[data-source-preview-crop]') as HTMLDivElement
    const cropClip = container.querySelector('[data-source-preview-crop-clip]') as HTMLDivElement
    const image = screen.getByAltText('来源缩略图 5') as HTMLImageElement
    expect(frame.className).toContain('overflow-hidden')
    expect(cropClip.className).toContain('overflow-hidden')
    expect(cropClip.style.clipPath).toBe('inset(0)')
    expect(cropClip.style.contain).toBe('paint')
    expect(frame.className).not.toContain('swiper-zoom-target')
    expect(image.style.visibility).toBe('hidden')
    expect(image.getAttribute('loading')).toBe('eager')

    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 900 },
      naturalHeight: { configurable: true, value: 450 }
    })
    fireEvent.load(image)

    act(() => resize?.([{ contentRect: { width: 600, height: 300 } }]))
    expect(image.style.width).toBe('1800px')
    expect(image.style.height).toBe('900px')
    expect(image.style.marginLeft).toBe('-240px')
    expect(image.style.marginTop).toBe('-80px')
    expect(image.style.visibility).toBe('')

    frame.style.transform = 'scale(2)'
    act(() => resize?.([{ contentRect: { width: 600, height: 300 } }]))
    expect(image.style.width).toBe('1800px')
    expect(image.style.marginLeft).toBe('-240px')
  })

  it('uses measured client dimensions for a cached image when ResizeObserver is unavailable', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    const naturalWidth = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(900)
    const naturalHeight = vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(450)
    render(
      <SourcePreviewThumbnail
        item={{
          ordinal: 4,
          url: 'https://t.example.test/sprite.jpg',
          width: 300,
          height: 150,
          crop: { x: 120, y: 40, width: 300, height: 150 }
        }}
        alt="来源缩略图 5"
      />
    )
    const image = screen.getByAltText('来源缩略图 5') as HTMLImageElement
    await waitFor(() => expect(image.style.visibility).toBe(''))
    expect(image.style.width).toBe('1800px')
    expect(image.style.height).toBe('900px')
    complete.mockRestore()
    naturalWidth.mockRestore()
    naturalHeight.mockRestore()
  })

  it('draws only the selected sprite crop into an isolated fullscreen canvas', () => {
    const onLoad = vi.fn()
    const { container } = render(
      <SourcePreviewThumbnail
        item={{
          ordinal: 1,
          url: 'https://t.example.test/atlas.jpg',
          width: 200,
          height: 200,
          crop: { x: 200, y: 0, width: 200, height: 200 }
        }}
        alt="来源缩略图 2"
        eager
        fullscreen
        zoomTarget
        onLoad={onLoad}
      />
    )
    const frame = container.querySelector('[data-source-preview-canvas-crop]') as HTMLDivElement
    const canvas = frame.querySelector('canvas') as HTMLCanvasElement
    const image = screen.getByAltText('来源缩略图 2') as HTMLImageElement
    expect(frame.className).toContain('swiper-zoom-target')
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(200)
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
    expect(canvas.style.visibility).toBe('hidden')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(image.className).toContain('size-px')

    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 600 },
      naturalHeight: { configurable: true, value: 400 }
    })
    fireEvent.load(image)

    expect(clearRect).toHaveBeenCalledWith(0, 0, 200, 200)
    expect(drawImage).toHaveBeenCalledWith(image, 200, 0, 200, 200, 0, 0, 200, 200)
    expect(canvas.style.visibility).toBe('visible')
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('reports a fullscreen canvas crop failure for the normal retry flow', () => {
    drawImage.mockImplementationOnce(() => {
      throw new Error('draw failed')
    })
    const onLoad = vi.fn()
    const onError = vi.fn()
    render(
      <SourcePreviewThumbnail
        item={{
          ordinal: 1,
          url: 'https://t.example.test/atlas.jpg',
          width: 200,
          height: 200,
          crop: { x: 200, y: 0, width: 200, height: 200 }
        }}
        alt="来源缩略图 2"
        fullscreen
        zoomTarget
        onLoad={onLoad}
        onError={onError}
      />
    )
    const image = screen.getByAltText('来源缩略图 2') as HTMLImageElement
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 600 },
      naturalHeight: { configurable: true, value: 400 }
    })
    fireEvent.load(image)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('draws a cached fullscreen sprite missed before hydration handlers attach', async () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    const naturalWidth = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(600)
    const naturalHeight = vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(400)
    render(
      <SourcePreviewThumbnail
        item={{
          ordinal: 1,
          url: 'https://t.example.test/atlas.jpg',
          width: 200,
          height: 200,
          crop: { x: 200, y: 0, width: 200, height: 200 }
        }}
        alt="来源缩略图 2"
        fullscreen
        zoomTarget
      />
    )
    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    await waitFor(() => expect(canvas.style.visibility).toBe('visible'))
    expect(drawImage).toHaveBeenCalledWith(screen.getByAltText('来源缩略图 2'), 200, 0, 200, 200, 0, 0, 200, 200)
    complete.mockRestore()
    naturalWidth.mockRestore()
    naturalHeight.mockRestore()
  })

  it('reports a cached failed list sprite missed before hydration handlers attach', async () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    const naturalWidth = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0)
    const naturalHeight = vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(0)
    const onLoad = vi.fn()
    const onError = vi.fn()
    render(
      <SourcePreviewThumbnail
        item={{
          ordinal: 1,
          url: 'https://t.example.test/failed-atlas.jpg',
          width: 200,
          height: 200,
          crop: { x: 200, y: 0, width: 200, height: 200 }
        }}
        alt="来源缩略图 2"
        onLoad={onLoad}
        onError={onError}
      />
    )
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onLoad).not.toHaveBeenCalled()
    expect(screen.getByAltText('来源缩略图 2').style.visibility).toBe('hidden')
    complete.mockRestore()
    naturalWidth.mockRestore()
    naturalHeight.mockRestore()
  })
})
