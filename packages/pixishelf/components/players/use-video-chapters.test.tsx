import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVideoChapters } from './use-video-chapters'

describe('useVideoChapters', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not request when chaptersUrl is empty', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useVideoChapters(null))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.chapters).toEqual([])
    expect(result.current.duration).toBe(0)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('treats 404 as empty chapters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 404,
        ok: false
      })
    )

    const { result } = renderHook(() => useVideoChapters('/api/v1/media/1/chapters'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.chapters).toEqual([])
    expect(result.current.duration).toBe(0)
    expect(result.current.error).toBeNull()
  })

  it('normalizes manifest when request succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          version: 1,
          duration: 120,
          chapters: [
            {
              index: 2,
              title: 'Second',
              start: 60,
              end: 120,
              duration: 60
            },
            {
              index: 1,
              title: 'Opening',
              start: 0,
              end: 60,
              duration: 60
            }
          ]
        })
      })
    )

    const { result } = renderHook(() => useVideoChapters('/api/v1/media/2/chapters'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.duration).toBe(120)
    expect(result.current.error).toBeNull()
    expect(result.current.chapters).toEqual([
      {
        id: 'chapter-1-0',
        index: 1,
        title: 'Opening',
        start: 0,
        end: 60,
        duration: 60
      },
      {
        id: 'chapter-2-60',
        index: 2,
        title: 'Second',
        start: 60,
        end: 120,
        duration: 60
      }
    ])
  })

  it('normalizes v2 manifest with extra metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          version: 2,
          generatedAt: '2026-06-07T18:32:30.8446895+08:00',
          video: 'output.mp4',
          output: {
            encoder: 'h264_nvenc'
          },
          duration: 20,
          chapters: [
            {
              index: 1,
              title: 'Opening',
              file: 'clip.mp4',
              start: 0,
              end: 20,
              duration: 20,
              source: {
                fileName: 'clip.mp4'
              },
              video: {
                codec: 'h264'
              }
            }
          ]
        })
      })
    )

    const { result } = renderHook(() => useVideoChapters('/api/v1/media/3/chapters'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.duration).toBe(20)
    expect(result.current.error).toBeNull()
    expect(result.current.chapters).toEqual([
      {
        id: 'chapter-1-0',
        index: 1,
        title: 'Opening',
        start: 0,
        end: 20,
        duration: 20
      }
    ])
  })
})
