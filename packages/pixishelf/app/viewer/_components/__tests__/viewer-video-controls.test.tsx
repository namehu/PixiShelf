import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MediaType } from '@/types'
import type { ViewerMediaItem } from '@/types/images'
import ViewerVideoControls, { formatViewerTime } from '../viewer-video-controls'

vi.mock('next/image', () => ({
  default: ({ fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    void fill
    return <img {...props} />
  }
}))

const videoMedia: ViewerMediaItem = {
  id: 1,
  key: 'video-1',
  url: '/video.mp4',
  updatedAt: '2026-08-11T00:00:00.000Z',
  mediaType: MediaType.VIDEO,
  chaptersUrl: null,
  hasAudio: true,
  duration: 95
}

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Element.prototype.scrollIntoView = vi.fn()
})

function renderControls(overrides: Partial<React.ComponentProps<typeof ViewerVideoControls>> = {}) {
  const props: React.ComponentProps<typeof ViewerVideoControls> = {
    media: videoMedia,
    state: { currentTime: 5, duration: 95, isPlaying: true, isWaiting: false },
    audioPreference: { muted: true, volume: 0.75 },
    onTogglePlayback: vi.fn(),
    onSeek: vi.fn(),
    onSeekPreviewStart: vi.fn(),
    onSeekCommit: vi.fn(),
    onSeekPreviewCancel: vi.fn(),
    onToggleMuted: vi.fn(),
    onVolumeChange: vi.fn(),
    chapterPanelOpen: false,
    onChapterPanelOpenChange: vi.fn(),
    ...overrides
  }

  return { ...render(<ViewerVideoControls {...props} />), props }
}

describe('ViewerVideoControls', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('formats compact viewer time values', () => {
    expect(formatViewerTime(3.9)).toBe('0:03')
    expect(formatViewerTime(65)).toBe('1:05')
    expect(formatViewerTime(3661)).toBe('1:01:01')
    expect(formatViewerTime(Number.NaN)).toBe('--:--')
  })

  it('renders playback, time, progress, and sound controls', () => {
    const { props } = renderControls()

    expect(screen.getByText('0:05 / 1:35')).toBeDefined()
    expect(screen.getByRole('slider', { name: '视频进度' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '暂停视频' }))
    fireEvent.click(screen.getByRole('button', { name: '开启声音' }))

    expect(props.onTogglePlayback).toHaveBeenCalledOnce()
    expect(props.onToggleMuted).toHaveBeenCalledOnce()
  })

  it('previews slider changes without committing a seek until the interaction completes', () => {
    const { props } = renderControls()
    const progress = screen.getByRole('slider', { name: '视频进度' })

    fireEvent.keyDown(progress, { key: 'ArrowRight' })
    expect(props.onSeek).not.toHaveBeenCalled()
    expect(props.onSeekPreviewStart).toHaveBeenCalledOnce()

    fireEvent.keyUp(progress, { key: 'ArrowRight' })
    expect(props.onSeekCommit).toHaveBeenCalledOnce()
  })

  it('keeps the chapter sheet open after seeking to a chapter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          version: 1,
          duration: 95,
          chapters: [
            { index: 1, title: 'Opening', start: 0, end: 40, duration: 40 },
            { index: 2, title: 'Ending', start: 40, end: 95, duration: 55 }
          ]
        })
      })
    )
    const onSeek = vi.fn()
    const onOpenChange = vi.fn()

    const { container } = renderControls({
      media: { ...videoMedia, chaptersUrl: '/api/v1/media/1/chapters' },
      chapterPanelOpen: true,
      onSeek,
      onChapterPanelOpenChange: onOpenChange
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /Ending/ })).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /Ending/ }))

    expect(onSeek).toHaveBeenCalledWith(40)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole('dialog', { name: /章节/ })).toBeDefined()
    expect(container.ownerDocument.querySelector('[data-chapter-layout="horizontal"]')).not.toBeNull()
    expect(container.ownerDocument.querySelectorAll('.pixishelf-chapter-card-horizontal')).toHaveLength(2)
  })
})
