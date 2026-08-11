import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ChapterAudioTrack from '../chapter-audio-track'
import type { NormalizedChapter } from '../video-chapters'

function createChapter(id: string, start: number, end: number, hasAudio?: boolean): NormalizedChapter {
  return {
    id,
    index: Number(id),
    title: `Chapter ${id}`,
    start,
    end,
    duration: end - start,
    hasAudio,
    previewStatus: 'PENDING',
    previewUrl: null,
    previewCaptureTime: null,
    previewUpdatedAt: null
  }
}

describe('ChapterAudioTrack', () => {
  afterEach(() => cleanup())

  it('renders known chapter states at their time-proportional positions', () => {
    const { container } = render(
      <ChapterAudioTrack
        duration={100}
        chapters={[createChapter('1', 0, 20, true), createChapter('2', 20, 50, false), createChapter('3', 50, 100)]}
      />
    )

    expect(screen.getByTestId('chapter-audio-track')).toBeDefined()
    const segments = container.querySelectorAll('[data-testid="chapter-audio-track"] > span')
    expect(segments).toHaveLength(2)
    expect((segments[0] as HTMLElement).style.width).toBe('20%')
    expect((segments[1] as HTMLElement).style.left).toBe('20%')
    expect((segments[1] as HTMLElement).style.width).toBe('30%')
  })

  it('does not render when every chapter state is unknown', () => {
    render(<ChapterAudioTrack duration={10} chapters={[createChapter('1', 0, 10)]} />)
    expect(screen.queryByTestId('chapter-audio-track')).toBeNull()
  })
})
