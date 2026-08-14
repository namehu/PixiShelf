import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generate: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }))
vi.mock('@/services/derived-media-storage', () => ({ VIDEO_CHAPTER_PREVIEW_STORAGE_ROOT: '/previews' }))
vi.mock('@pixishelf/job-executors', () => ({
  generateVideoChapterPreviews: mocks.generate,
  runVideoProcess: vi.fn()
}))

import { runVideoChapterPreviewGenerationJob } from '../video-chapter-preview-service'

describe('video chapter preview Next boundary', () => {
  beforeEach(() => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'false')
    mocks.generate.mockReset().mockResolvedValue({ mode: 'FULL', generated: 1 })
  })

  it('keeps the compatibility path while central cutover is disabled', async () => {
    await expect(runVideoChapterPreviewGenerationJob({ scanPath: '/scan', mode: 'FULL' })).resolves.toEqual({
      mode: 'FULL',
      generated: 1
    })
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'legacy-chapter-compat',
        mode: 'FULL',
        config: expect.objectContaining({ scanRoot: '/scan' })
      })
    )
  })

  it('hard-stops Next execution after central cutover', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    await expect(runVideoChapterPreviewGenerationJob({ scanPath: '/scan' })).rejects.toThrow(
      'Legacy background execution is disabled'
    )
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})
