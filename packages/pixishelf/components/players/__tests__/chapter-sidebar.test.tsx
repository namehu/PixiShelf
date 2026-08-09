import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChapterSidebar from '../chapter-sidebar'
import type { NormalizedChapter } from '../video-chapters'

const chapters: NormalizedChapter[] = [
  {
    id: 'chapter-1',
    index: 1,
    title: 'Opening',
    start: 0,
    end: 10,
    duration: 10,
    previewStatus: 'COMPLETED',
    previewUrl: '/_video-chapter-previews/1/hash/0.webp?v=1',
    previewCaptureTime: 1,
    previewUpdatedAt: '2026-08-09T00:00:00.000Z'
  },
  {
    id: 'chapter-2',
    index: 2,
    title: 'Ending',
    start: 10,
    end: 20,
    duration: 10,
    previewStatus: 'FAILED',
    previewUrl: null,
    previewCaptureTime: 11,
    previewUpdatedAt: null
  }
]

describe('ChapterSidebar', () => {
  afterEach(() => cleanup())

  it('renders a two-column chapter grid with preview, time, and active state', () => {
    render(
      <ChapterSidebar chapters={chapters} currentChapterId="chapter-1" onChapterClick={vi.fn()} tone="dark" />
    )

    expect(screen.getByRole('img', { name: 'Opening 章节截图' })).toBeDefined()
    expect(screen.getByText('00:00')).toBeDefined()
    expect(screen.getByText('生成失败')).toBeDefined()
    expect(screen.getByRole('button', { name: /Opening/ }).getAttribute('aria-current')).toBe('true')
  })

  it('keeps failed preview cards clickable for seeking', () => {
    const onChapterClick = vi.fn()
    render(<ChapterSidebar chapters={chapters} onChapterClick={onChapterClick} tone="dark" />)

    fireEvent.click(screen.getByRole('button', { name: /Ending/ }))

    expect(onChapterClick).toHaveBeenCalledWith(chapters[1])
  })

  it('renders a horizontally snapping rail while preserving chapter behavior', () => {
    const onChapterClick = vi.fn()
    const { container } = render(
      <ChapterSidebar
        chapters={chapters}
        currentChapterId="chapter-2"
        onChapterClick={onChapterClick}
        tone="dark"
        layout="horizontal"
      />
    )

    expect(container.querySelector('[data-chapter-layout="horizontal"]')).not.toBeNull()
    expect(container.querySelector('.snap-x')).not.toBeNull()
    expect(container.querySelectorAll('.pixishelf-chapter-card-horizontal')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /Opening/ }))
    expect(onChapterClick).toHaveBeenCalledWith(chapters[0])
  })
})
