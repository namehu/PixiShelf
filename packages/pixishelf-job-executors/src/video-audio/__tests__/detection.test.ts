import { describe, expect, it } from 'vitest'
import {
  buildChapterAudioSampleWindows,
  buildUnchapteredAudioSampleWindows,
  isAudibleMaxVolume,
  parseCompanionAudioManifest,
  parseVolumedetectMaxVolume
} from '../detection.js'

describe('video audio detection policy', () => {
  it('scans a short chapter completely and samples long chapters at 25% and 75%', () => {
    expect(buildChapterAudioSampleWindows(5, 17)).toEqual([{ start: 5, duration: 12 }])
    expect(buildChapterAudioSampleWindows(10, 50)).toEqual([
      { start: 15, duration: 10 },
      { start: 35, duration: 10 }
    ])
  })

  it('uses first, middle, and final windows for long videos without chapters', () => {
    expect(buildUnchapteredAudioSampleWindows(100)).toEqual([
      { start: 0, duration: 10 },
      { start: 45, duration: 10 },
      { start: 90, duration: 10 }
    ])
    expect(buildUnchapteredAudioSampleWindows(15)).toEqual([
      { start: 0, duration: 10 },
      { start: 2.5, duration: 10 },
      { start: 5, duration: 10 }
    ])
    expect(buildUnchapteredAudioSampleWindows(8)).toEqual([{ start: 0, duration: 8 }])
  })

  it('treats negative infinity and synthetic AAC noise as silent', () => {
    expect(parseVolumedetectMaxVolume('max_volume: -inf dB')).toBe(Number.NEGATIVE_INFINITY)
    expect(parseVolumedetectMaxVolume('max_volume: -91.0 dB')).toBe(-91)
    expect(isAudibleMaxVolume(-91)).toBe(false)
    expect(isAudibleMaxVolume(-20)).toBe(true)
  })

  it('accepts v3 chapter manifests and caps invalid chapter inventories', () => {
    expect(
      parseCompanionAudioManifest(
        {
          version: 3,
          video: 'output.mp4',
          duration: 8,
          chapters: [
            { index: 1, start: 0, end: 4, duration: 4 },
            { index: 2, start: 4, end: 8, duration: 4 }
          ]
        },
        'output.mp4'
      )
    ).toMatchObject({ version: 3, chapters: [{ start: 0 }, { start: 4 }] })
    expect(
      parseCompanionAudioManifest(
        { version: 3, video: 'other.mp4', duration: 4, chapters: [{ index: 1, start: 0, end: 4, duration: 4 }] },
        'output.mp4'
      )
    ).toBeNull()

    const thousandChapters = Array.from({ length: 1_000 }, (_, index) => ({
      index: index + 1,
      start: index,
      end: index + 1,
      duration: 1
    }))
    expect(
      parseCompanionAudioManifest(
        { version: 3, video: 'output.mp4', duration: 1_000, chapters: thousandChapters },
        'output.mp4'
      )?.chapters
    ).toHaveLength(1_000)
    expect(
      parseCompanionAudioManifest(
        {
          version: 3,
          video: 'output.mp4',
          duration: 1_001,
          chapters: [...thousandChapters, { index: 1_001, start: 1_000, end: 1_001, duration: 1 }]
        },
        'output.mp4'
      )
    ).toBeNull()
  })
})
