import { describe, expect, it } from 'vitest'
import { clusterTimelineMarkers, getAdjacentChapters, type NormalizedChapter, type TimelineMarker } from './video-chapters'

function createMarkers(count: number, spacingSeconds = 10): TimelineMarker[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `marker-${index + 1}`,
    type: 'chapter',
    title: `Chapter ${index + 1}`,
    time: index * spacingSeconds
  }))
}

describe('clusterTimelineMarkers', () => {
  it('keeps markers separate when they have enough pixel space', () => {
    const markers = createMarkers(3, 120)

    expect(clusterTimelineMarkers(markers, { duration: 360, width: 360, minSpacingPx: 28 })).toEqual([
      { id: 'marker-1', marker: markers[0], markers: [markers[0]], count: 1, time: 0 },
      { id: 'marker-2', marker: markers[1], markers: [markers[1]], count: 1, time: 120 },
      { id: 'marker-3', marker: markers[2], markers: [markers[2]], count: 1, time: 240 }
    ])
  })

  it('clusters dense markers and uses the first marker time as the representative time', () => {
    const markers = createMarkers(60, 10)
    const clustered = clusterTimelineMarkers(markers, { duration: 600, width: 320, minSpacingPx: 28 })

    expect(clustered.length).toBeLessThan(markers.length)
    expect(clustered.some((cluster) => cluster.count > 1)).toBe(true)

    const firstCluster = clustered[0]
    const firstMarker = markers[0]
    expect(firstCluster).toBeDefined()
    expect(firstMarker).toBeDefined()
    if (!firstCluster || !firstMarker) throw new Error('Expected first cluster and marker')
    expect(firstCluster.count).toBeGreaterThan(1)
    expect(firstCluster.time).toBe(firstMarker.time)
    expect(firstCluster.marker).toBe(firstMarker)
  })

  it('returns no clusters for empty markers or invalid duration', () => {
    expect(clusterTimelineMarkers([], { duration: 600, width: 320, minSpacingPx: 28 })).toEqual([])
    expect(clusterTimelineMarkers(createMarkers(2), { duration: 0, width: 320, minSpacingPx: 28 })).toEqual([])
    expect(clusterTimelineMarkers(createMarkers(2), { duration: Number.NaN, width: 320, minSpacingPx: 28 })).toEqual([])
  })
})

describe('getAdjacentChapters', () => {
  const chapters: NormalizedChapter[] = [
    { id: 'chapter-1', index: 1, title: 'Opening', start: 0, end: 10, duration: 10 },
    { id: 'chapter-2', index: 2, title: 'Middle', start: 20, end: 30, duration: 10 },
    { id: 'chapter-3', index: 3, title: 'Finale', start: 40, end: 50, duration: 10 }
  ]

  it('returns only the next chapter while playing the first chapter', () => {
    expect(getAdjacentChapters(chapters, 5)).toEqual({ next: chapters[1] })
  })

  it('returns both adjacent chapters while playing a middle chapter', () => {
    expect(getAdjacentChapters(chapters, 25)).toEqual({ previous: chapters[0], next: chapters[2] })
  })

  it('returns only the previous chapter while playing the final chapter', () => {
    expect(getAdjacentChapters(chapters, 45)).toEqual({ previous: chapters[1] })
  })

  it('treats the final chapter end as part of the final chapter', () => {
    expect(getAdjacentChapters(chapters, 50)).toEqual({ previous: chapters[1] })
  })

  it('finds the closest chapters around a gap', () => {
    expect(getAdjacentChapters(chapters, 15)).toEqual({ previous: chapters[0], next: chapters[1] })
  })

  it('returns no targets when no chapters are available', () => {
    expect(getAdjacentChapters([], 15)).toEqual({})
  })
})
