import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  transactionMock,
  queryRawMock,
  findFirstMock,
  findManyMock,
  imageFindManyMock,
  countMock,
  createMock,
  updateMock,
  findUniqueMock,
  updateManyMock,
  jobUpdateManyMock,
  getScanPathMock,
  setFindManyMock,
  setFindUniqueMock,
  readdirMock,
  rmMock,
  rmdirMock,
  statMock,
  sourceFingerprintFromStatMock,
  resolveExistingPathWithinRootMock
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  queryRawMock: vi.fn(),
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  imageFindManyMock: vi.fn(),
  countMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  findUniqueMock: vi.fn(),
  updateManyMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  getScanPathMock: vi.fn(),
  setFindManyMock: vi.fn(),
  setFindUniqueMock: vi.fn(),
  readdirMock: vi.fn(),
  rmMock: vi.fn(),
  rmdirMock: vi.fn(),
  statMock: vi.fn(),
  sourceFingerprintFromStatMock: vi.fn(),
  resolveExistingPathWithinRootMock: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  readdir: readdirMock,
  rm: rmMock,
  rmdir: rmdirMock,
  stat: statMock
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock,
    systemJob: {
      findFirst: findFirstMock,
      count: countMock,
      create: createMock,
      update: updateMock,
      findUnique: findUniqueMock,
      findMany: findManyMock,
      updateMany: jobUpdateManyMock
    },
    image: { findMany: imageFindManyMock },
    mediaVideoKeyframeSet: { findMany: setFindManyMock }
  }
}))

vi.mock('@/lib/safe-path', () => ({
  resolveExistingPathWithinRoot: resolveExistingPathWithinRootMock
}))

vi.mock('@/services/video-keyframe-service', () => ({
  getPublishedVideoKeyframes: vi.fn(),
  regenerateManualVideoPoster: vi.fn(),
  removeJobStagingSet: vi.fn(),
  sourceFingerprintFromStat: sourceFingerprintFromStatMock
}))

vi.mock('@/services/setting.service', () => ({ getScanPath: getScanPathMock }))

import { listVideoKeyframeQueue, requireVideoKeyframeScanPath } from '../video-keyframe-queue'

const tx = {
  $queryRawUnsafe: queryRawMock,
  systemJob: {
    findFirst: findFirstMock,
    count: countMock,
    create: createMock,
    update: updateMock,
    findUnique: findUniqueMock,
    findMany: findManyMock,
    updateMany: jobUpdateManyMock
  },
  mediaVideoKeyframeSet: {
    updateMany: updateManyMock,
    findMany: setFindManyMock,
    findUnique: setFindUniqueMock
  },
  mediaVideoKeyframe: { updateMany: updateManyMock }
}

describe('video keyframe queue', () => {
  beforeEach(() => {
    transactionMock.mockReset().mockImplementation((callback) => callback(tx))
    queryRawMock.mockReset().mockResolvedValue([])
    findFirstMock.mockReset().mockResolvedValue(null)
    findManyMock.mockReset().mockResolvedValue([])
    imageFindManyMock.mockReset().mockResolvedValue([])
    countMock.mockReset()
    createMock.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: 'job-1', ...data }))
    updateMock.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: 'job-1', ...data }))
    findUniqueMock.mockReset()
    updateManyMock.mockReset().mockResolvedValue({ count: 0 })
    jobUpdateManyMock.mockReset().mockResolvedValue({ count: 1 })
    getScanPathMock.mockReset().mockResolvedValue('/scan')
    setFindManyMock.mockReset().mockResolvedValue([])
    setFindUniqueMock.mockReset().mockResolvedValue(null)
    readdirMock.mockReset().mockResolvedValue([])
    rmMock.mockReset().mockResolvedValue(undefined)
    rmdirMock.mockReset().mockResolvedValue(undefined)
    statMock.mockReset().mockResolvedValue({ isFile: () => true })
    sourceFingerprintFromStatMock.mockReset().mockReturnValue({ size: 100, mtimeMs: 200 })
    resolveExistingPathWithinRootMock.mockReset().mockResolvedValue('/scan/artist/video.mp4')
  })

  it('lists discovery work separately without consuming generation capacity', async () => {
    findManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'discovery-active', type: 'VIDEO_KEYFRAME_DISCOVERY', status: 'RUNNING' }])
      .mockResolvedValueOnce([{ id: 'discovery-failed', type: 'VIDEO_KEYFRAME_DISCOVERY', status: 'FAILED' }])

    const queue = await listVideoKeyframeQueue()

    expect(queue.active).toEqual([])
    expect(queue.discoveryActive).toEqual([expect.objectContaining({ id: 'discovery-active', queuePosition: null })])
    expect(queue.discoveryRecent).toEqual([expect.objectContaining({ id: 'discovery-failed', queuePosition: null })])
    expect(queue.capacity).toBe(100)
  })

  it('prefers the worker container scan mount over a host path stored in the database', async () => {
    getScanPathMock.mockResolvedValueOnce('D:\\media')
    const previous = process.env.SCAN_PATH
    process.env.SCAN_PATH = '/app/data'
    try {
      await expect(requireVideoKeyframeScanPath()).resolves.toBe('/app/data')
    } finally {
      if (previous === undefined) delete process.env.SCAN_PATH
      else process.env.SCAN_PATH = previous
    }
  })
})
