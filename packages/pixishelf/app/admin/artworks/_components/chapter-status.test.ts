import { describe, expect, it } from 'vitest'
import { formatChapterDuration, getChapterStatusSummary } from './chapter-status'

describe('chapter-status', () => {
  it('formats chapter duration as mm:ss when under one hour', () => {
    expect(formatChapterDuration(104.2)).toBe('01:44')
  })

  it('formats chapter duration as hh:mm:ss when over one hour', () => {
    expect(formatChapterDuration(3661)).toBe('01:01:01')
  })

  it('returns success status for valid video chapters', () => {
    expect(
      getChapterStatusSummary({
        id: 1,
        path: '/artist/artwork/video.mp4',
        sortOrder: 1,
        width: null,
        height: null,
        size: null,
        mediaType: 'video',
        hasChapters: true,
        chaptersCount: 12,
        chaptersDuration: 104.2
      })
    ).toEqual({
      text: '12 段 / 01:44',
      tone: 'success'
    })
  })

  it('returns warning status for dirty chapter data', () => {
    expect(
      getChapterStatusSummary({
        id: 2,
        path: '/artist/artwork/video.mp4',
        sortOrder: 1,
        width: null,
        height: null,
        size: null,
        mediaType: 'video',
        hasChapters: false,
        chaptersPath: '/artist/artwork/video.chapters.json',
        chaptersCount: 0,
        chaptersDuration: null
      })
    ).toEqual({
      text: '章节数据异常',
      tone: 'warning'
    })
  })
})
