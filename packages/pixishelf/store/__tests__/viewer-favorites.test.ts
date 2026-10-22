import { beforeEach, describe, expect, it } from 'vitest'
import { useViewerStore } from '../viewer-store'
import type { RandomImageItem } from '@/types/images'

const artwork = (id: number) => ({ id, isLike: true, ratingLevel: 2 }) as RandomImageItem
beforeEach(() => useViewerStore.setState(useViewerStore.getInitialState()))

describe('viewer membership refresh', () => {
  it('retains the visible artwork when a preceding favorite is removed', () => {
    const store = useViewerStore.getState()
    store.setImages([artwork(1), artwork(2), artwork(3)])
    store.setVerticalIndex(1)
    store.setImages([artwork(2), artwork(3)])
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    expect(useViewerStore.getState().artworkRatingMap.has(1)).toBe(false)
  })

  it('keeps a valid position after unliking the last visible artwork and clears account state on reset', () => {
    const store = useViewerStore.getState()
    store.setImages([artwork(1), artwork(2)])
    store.setVerticalIndex(1)
    store.setImages([artwork(1)])
    expect(useViewerStore.getState().verticalIndex).toBe(0)
    store.resetViewerState()
    expect(useViewerStore.getState().artworkRatingMap.size).toBe(0)
    expect(useViewerStore.getState().images).toEqual([])
  })

  it('keeps the exact rating while deriving heart state from the positive levels', () => {
    const store = useViewerStore.getState()
    store.setImages([artwork(1)])
    store.syncImageRatingStatus(1, 4)
    expect(useViewerStore.getState().artworkRatingMap.get(1)).toBe(4)
    expect(useViewerStore.getState().images[0]).toMatchObject({ ratingLevel: 4, isLike: true })
    store.syncImageRatingStatus(1, 1)
    expect(useViewerStore.getState().images[0]).toMatchObject({ ratingLevel: 1, isLike: false })
  })
})
