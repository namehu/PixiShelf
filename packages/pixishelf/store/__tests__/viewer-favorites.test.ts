import { beforeEach, describe, expect, it } from 'vitest'
import { useViewerStore } from '../viewer-store'
import type { RandomImageItem } from '@/types/images'

const artwork = (id: number) => ({ id, isLike: true }) as RandomImageItem
beforeEach(() => useViewerStore.setState(useViewerStore.getInitialState()))

describe('viewer membership refresh', () => {
  it('retains the visible artwork when a preceding favorite is removed', () => {
    const store = useViewerStore.getState()
    store.setImages([artwork(1), artwork(2), artwork(3)])
    store.setVerticalIndex(1)
    store.setImages([artwork(2), artwork(3)])
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    expect(useViewerStore.getState().artworkLikeMap.has(1)).toBe(false)
  })

  it('keeps a valid position after unliking the last visible artwork and clears account state on reset', () => {
    const store = useViewerStore.getState()
    store.setImages([artwork(1), artwork(2)])
    store.setVerticalIndex(1)
    store.setImages([artwork(1)])
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    store.resetViewerState()
    expect(useViewerStore.getState().artworkLikeMap.size).toBe(0)
    expect(useViewerStore.getState().images).toEqual([])
  })
})
