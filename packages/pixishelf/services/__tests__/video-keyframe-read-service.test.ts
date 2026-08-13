import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  stat: vi.fn(),
  getScanPath: vi.fn(),
  resolveSource: vi.fn(),
  filesExist: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { image: { findUnique: mocks.findUnique } }
}))
vi.mock('node:fs/promises', () => ({ stat: mocks.stat }))
vi.mock('@/services/setting.service', () => ({ getScanPath: mocks.getScanPath }))
vi.mock('@/lib/safe-path', () => ({ resolveExistingPathWithinRoot: mocks.resolveSource }))
vi.mock('@/services/video-keyframe-discovery-state', () => ({
  publishedVideoKeyframeFilesExist: mocks.filesExist
}))
vi.mock('@/services/video-keyframe-service', () => ({
  sourceFingerprintFromStat: (stat: { size: number; mtimeMs: number }) => ({
    size: BigInt(stat.size),
    mtimeMs: BigInt(Math.round(stat.mtimeMs))
  })
}))

import { getPlayableVideoKeyframesByImageId } from '../video-keyframe-read-service'

const publishedSet = {
  id: 'set-1',
  sourceSize: BigInt(2048),
  sourceMtimeMs: BigInt(1234),
  publishedCount: 2,
  publishedAt: new Date('2026-08-13T00:00:00.000Z'),
  updatedAt: new Date('2026-08-13T00:00:00.000Z'),
  frames: [
    {
      id: 'frame-1',
      captureTime: 10,
      selectedOrder: 0,
      path: '1/set-1/001.webp',
      updatedAt: new Date('2026-08-13T00:00:01.000Z')
    },
    {
      id: 'frame-2',
      captureTime: 20,
      selectedOrder: 1,
      path: '1/set-1/002.webp',
      updatedAt: new Date('2026-08-13T00:00:02.000Z')
    }
  ]
}

describe('getPlayableVideoKeyframesByImageId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findUnique.mockResolvedValue({ id: 1, path: '/video.mp4', mediaType: 'VIDEO', keyframeSets: [publishedSet] })
    mocks.getScanPath.mockResolvedValue('/scan')
    mocks.resolveSource.mockResolvedValue('/scan/video.mp4')
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 2048, mtimeMs: 1234 })
    mocks.filesExist.mockResolvedValue(true)
  })

  it('returns only the current published collection', async () => {
    const manifest = await getPlayableVideoKeyframesByImageId(1)

    expect(manifest).toMatchObject({ version: 1, imageId: 1, count: 2 })
    expect(manifest?.frames.map((frame) => frame.captureTime)).toEqual([10, 20])
    expect(manifest?.frames[0]?.url).toContain('/_video-keyframes/1/set-1/001.webp')
  })

  it('hides a published collection when the source fingerprint changed', async () => {
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 2048, mtimeMs: 9999 })

    await expect(getPlayableVideoKeyframesByImageId(1)).resolves.toBeNull()
    expect(mocks.filesExist).not.toHaveBeenCalled()
  })

  it('hides a collection with missing derived files', async () => {
    mocks.filesExist.mockResolvedValue(false)
    await expect(getPlayableVideoKeyframesByImageId(1)).resolves.toBeNull()
  })
})
