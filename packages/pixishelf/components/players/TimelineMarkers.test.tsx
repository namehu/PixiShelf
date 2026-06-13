import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TimelineMarkers from './TimelineMarkers'
import type { TimelineMarker } from './video-chapters'

const markers: TimelineMarker[] = [
  { id: 'chapter-1', type: 'chapter', title: 'Chapter 1', time: 0 },
  { id: 'chapter-2', type: 'chapter', title: 'Chapter 2', time: 10 },
  { id: 'chapter-3', type: 'chapter', title: 'Chapter 3', time: 20 }
]

describe('TimelineMarkers', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders sparse markers as normal chapter jump buttons', () => {
    const onMarkerClick = vi.fn()

    render(<TimelineMarkers markers={[markers[0]]} duration={120} width={360} onMarkerClick={onMarkerClick} />)

    fireEvent.click(screen.getByRole('button', { name: '跳转到章节 Chapter 1' }))

    expect(screen.queryByText('+1')).toBeNull()
    expect(onMarkerClick).toHaveBeenCalledWith(markers[0])
  })

  it('renders dense nearby markers as a colored dot without a count badge', () => {
    const onMarkerClick = vi.fn()

    render(<TimelineMarkers markers={markers} duration={120} width={120} minMarkerSpacingPx={28} onMarkerClick={onMarkerClick} />)

    const aggregateButton = screen.getByRole('button', { name: '跳转到聚合章节 3 个，起点 Chapter 1' })
    const aggregateDot = aggregateButton.querySelector('span:last-child')

    expect(aggregateDot?.className).toContain('bg-blue-500')
    expect(screen.queryByText('+3')).toBeNull()
    fireEvent.click(aggregateButton)
    expect(onMarkerClick).toHaveBeenCalledWith(markers[0])
  })
})
