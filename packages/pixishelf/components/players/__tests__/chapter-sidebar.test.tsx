import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders a two-column chapter grid with preview, time, and active state', () => {
    render(<ChapterSidebar chapters={chapters} currentChapterId="chapter-1" onChapterClick={vi.fn()} tone="dark" />)

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

  it('shows chapter audio state only when the manifest contains known states', () => {
    const chaptersWithAudio = [
      { ...chapters[0]!, hasAudio: true },
      { ...chapters[1]!, hasAudio: false },
      {
        ...chapters[1]!,
        id: 'chapter-3',
        index: 3,
        title: 'Unknown audio',
        start: 20,
        end: 30,
        hasAudio: undefined
      }
    ]

    render(<ChapterSidebar chapters={chaptersWithAudio} onChapterClick={vi.fn()} tone="dark" />)

    expect(screen.getByLabelText('有音频')).toBeDefined()
    expect(screen.getByLabelText('无音频')).toBeDefined()
    expect(screen.getByLabelText('音频状态未知')).toBeDefined()
  })

  it('lets user scrolling win and only restores an offscreen active item after 5000ms', () => {
    vi.useFakeTimers()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { container, rerender } = render(
      <ChapterSidebar
        chapters={chapters}
        currentChapterId="chapter-1"
        onChapterClick={vi.fn()}
        tone="dark"
        layout="horizontal"
      />
    )
    const viewport = container.querySelector<HTMLElement>('[data-chapter-layout="horizontal"] > div')!
    const ending = screen.getByRole('button', { name: /Ending/ })
    viewport.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 100 }) as DOMRect
    ending.getBoundingClientRect = () => ({ left: 180, right: 280, top: 0, bottom: 100 }) as DOMRect
    scrollIntoView.mockClear()

    fireEvent.wheel(viewport)
    rerender(
      <ChapterSidebar
        chapters={chapters}
        currentChapterId="chapter-2"
        onChapterClick={vi.fn()}
        tone="dark"
        layout="horizontal"
      />
    )

    act(() => vi.advanceTimersByTime(4999))
    expect(scrollIntoView).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  })
})
