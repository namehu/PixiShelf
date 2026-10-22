import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArtworkAutoBrowseStore as store } from '@/store/use-artwork-auto-browse-store'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { buildArtworkStacks } from '@/lib/reading/artwork-stacks'
import { useArtworkStackSlideshow } from '../use-artwork-stack-slideshow'

const mocks = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('../artwork-summary-context', () => ({ useArtworkSummary: () => mocks.session }))
const images = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, mediaType: 'image', path: `${index}.jpg` } as ArtworkImageResponseDto))
const groups = buildArtworkStacks(images.map((image, index) => ({ mediaId: image.id, memberMediaIds: [image.id], index, mediaType: 'image', isAnimated: false })))
let root: HTMLDivElement
let select: ReturnType<typeof vi.fn>
let reveal: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  store.getState().initialize(1)
  store.getState().setPreferences({ slideSeconds: 0.5, loop: false })
  root = document.createElement('div')
  root.innerHTML = images.map((image) => `<div data-auto-media-id="${image.id}" data-preview-status="ready"></div>`).join('')
  document.body.append(root)
  select = vi.fn()
  reveal = vi.fn()
  mocks.session = { byMediaId: new Map(groups.flatMap((group) => group.mediaIds.map((id) => [id, group]))), activeByGroup: new Map(), selectMedia: select, reveal, navigating: false }
})
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.useRealTimers() })
function start(id: number) {
  store.getState().setCurrentMedia(id)
  store.getState().start('slideshow')
  return renderHook(({ enabled }) => useArtworkStackSlideshow({ images, containerRef: { current: root }, enabled }), { initialProps: { enabled: true } })
}
describe('stack slideshow integration', () => {
  it('visits members in original order and scrolls only at group boundaries', () => {
    start(3)
    act(() => vi.advanceTimersByTime(500))
    expect(store.getState().currentMediaId).toBe(4)
    expect(select).toHaveBeenCalledWith(4)
    expect(reveal).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(500))
    expect(store.getState().currentMediaId).toBe(5)
    expect(reveal).toHaveBeenCalledWith(5)
    expect(store.getState().status).toBe('running')
  })
  it('suspends the detail driver while preview or navigation owns the surface', () => {
    const hook = start(3)
    act(() => store.getState().setPreviewOpen(true))
    act(() => vi.advanceTimersByTime(5000))
    expect(store.getState().currentMediaId).toBe(3)
    act(() => store.getState().setPreviewOpen(false))
    hook.rerender({ enabled: false })
    act(() => vi.advanceTimersByTime(5000))
    expect(store.getState().currentMediaId).toBe(3)
  })
  it('pauses on active-image failure without advancing', () => {
    root.querySelector('[data-auto-media-id="3"]')!.setAttribute('data-preview-status', 'error')
    start(3)
    expect(store.getState()).toMatchObject({ status: 'paused', reason: 'error' })
    act(() => vi.advanceTimersByTime(5000))
    expect(store.getState().currentMediaId).toBe(3)
  })
  it('ends without wrapping unless loop is enabled', () => {
    start(8)
    act(() => vi.advanceTimersByTime(500))
    expect(store.getState().status).toBe('ended')
    expect(reveal).not.toHaveBeenCalled()
    act(() => { store.getState().setPreferences({ loop: true }); store.getState().start('slideshow') })
    act(() => vi.advanceTimersByTime(500))
    expect(reveal).toHaveBeenCalledWith(1)
  })
})
