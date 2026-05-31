import { describe, expect, it } from 'vitest'
import { buildReplaceChapterUploadPlan } from './video-chapter-utils'

describe('buildReplaceChapterUploadPlan', () => {
  it('should match chapter files to videos by original basename and rename canonically', () => {
    const result = buildReplaceChapterUploadPlan(
      [
        { id: 'v1', originalName: 'foo.mp4', newName: 'external_p0.mp4' },
        { id: 'v2', originalName: 'bar.webm', newName: 'external_p1.webm' }
      ],
      [
        { id: 'c1', originalName: 'foo.chapters.json' },
        { id: 'c2', originalName: 'bar..chapters.json' }
      ]
    )

    expect(result.unmatched).toEqual([])
    expect(result.conflicting).toEqual([])
    expect(result.matched).toEqual([
      {
        chapterId: 'c1',
        chapterOriginalName: 'foo.chapters.json',
        videoId: 'v1',
        videoOriginalName: 'foo.mp4',
        videoNewName: 'external_p0.mp4',
        chapterNewName: 'external_p0.chapters.json'
      },
      {
        chapterId: 'c2',
        chapterOriginalName: 'bar..chapters.json',
        videoId: 'v2',
        videoOriginalName: 'bar.webm',
        videoNewName: 'external_p1.webm',
        chapterNewName: 'external_p1.chapters.json'
      }
    ])
  })

  it('should report unmatched chapter files', () => {
    const result = buildReplaceChapterUploadPlan(
      [{ id: 'v1', originalName: 'foo.mp4', newName: 'a_p0.mp4' }],
      [{ id: 'c1', originalName: 'bar.chapters.json' }]
    )

    expect(result.matched).toEqual([])
    expect(result.unmatched).toEqual([{ id: 'c1', originalName: 'bar.chapters.json' }])
    expect(result.conflicting).toEqual([])
  })

  it('should mark multiple chapter files for the same video as conflicting', () => {
    const result = buildReplaceChapterUploadPlan(
      [{ id: 'v1', originalName: 'foo.mp4', newName: 'a_p0.mp4' }],
      [
        { id: 'c1', originalName: 'foo.chapters.json' },
        { id: 'c2', originalName: 'foo..chapters.json' }
      ]
    )

    expect(result.matched).toEqual([])
    expect(result.unmatched).toEqual([])
    expect(result.conflicting).toEqual([
      {
        videoId: 'v1',
        videoOriginalName: 'foo.mp4',
        chapterIds: ['c1', 'c2'],
        chapterOriginalNames: ['foo.chapters.json', 'foo..chapters.json']
      }
    ])
  })
})
