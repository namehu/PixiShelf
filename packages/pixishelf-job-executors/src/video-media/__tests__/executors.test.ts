import { describe, expect, it } from 'vitest'
import { createVideoMediaExecutorRegistrations } from '../executors.js'

describe('video media executor registrations', () => {
  it('registers exactly the three Phase 4B v1 capabilities', () => {
    const registrations = createVideoMediaExecutorRegistrations({
      database: {} as never,
      config: { scanRoot: '/scan', posterStorageRoot: '/posters', chapterPreviewStorageRoot: '/chapters' }
    })
    expect(registrations.map(({ jobType, definitionVersion }) => ({ jobType, definitionVersion }))).toEqual([
      { jobType: 'VIDEO_MEDIA_PROBE', definitionVersion: 1 },
      { jobType: 'VIDEO_POSTER_GENERATION', definitionVersion: 1 },
      { jobType: 'DERIVED_MEDIA_GC', definitionVersion: 1 }
    ])
  })

  it('rejects traversal payloads before an executor can run', () => {
    const registrations = createVideoMediaExecutorRegistrations({
      database: {} as never,
      config: { scanRoot: '/scan', posterStorageRoot: '/posters', chapterPreviewStorageRoot: '/chapters' }
    })
    const poster = registrations.find(({ jobType }) => jobType === 'VIDEO_POSTER_GENERATION')!
    expect(() => poster.parsePayload?.({ imageId: 1, relativePath: '../outside.mp4' })).toThrow()
  })
})
