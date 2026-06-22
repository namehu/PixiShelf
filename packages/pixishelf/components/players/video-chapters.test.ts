import { describe, expect, it } from 'vitest'
import { clusterTimelineMarkers, type TimelineMarker } from './video-chapters'

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
