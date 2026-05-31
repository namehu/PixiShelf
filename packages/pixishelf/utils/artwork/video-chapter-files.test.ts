import { describe, expect, it } from 'vitest'
import {
  buildCanonicalChapterFileName,
  getVideoBaseNameFromChapterFile,
  isChapterManifestFileName
} from './video-chapter-files'

describe('video chapter file helpers', () => {
  it('should detect both canonical and legacy chapter file names', () => {
    expect(isChapterManifestFileName('video.chapters.json')).toBe(true)
    expect(isChapterManifestFileName('video..chapters.json')).toBe(true)
    expect(isChapterManifestFileName('video.json')).toBe(false)
  })

  it('should extract video base name from canonical and legacy names', () => {
    expect(getVideoBaseNameFromChapterFile('video.chapters.json')).toBe('video')
    expect(getVideoBaseNameFromChapterFile('video..chapters.json')).toBe('video')
    expect(getVideoBaseNameFromChapterFile('video.mp4')).toBeNull()
  })

  it('should build canonical chapter file name from video file name', () => {
    expect(buildCanonicalChapterFileName('externalId_p1.mp4')).toBe('externalId_p1.chapters.json')
  })
})
