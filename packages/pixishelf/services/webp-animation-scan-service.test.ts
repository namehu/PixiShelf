import { beforeEach, describe, expect, it, vi } from 'vitest'

const { countMock, findManyMock, metadataMock, sharpMock, updateManyMock, updateMock } = vi.hoisted(() => ({
  countMock: vi.fn(),
  findManyMock: vi.fn(),
  metadataMock: vi.fn(),
  sharpMock: vi.fn(),
  updateManyMock: vi.fn(),
  updateMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    image: {
      updateMany: updateManyMock,
      count: countMock,
      findMany: findManyMock,
      update: updateMock
    }
  }
}))

vi.mock('sharp', () => ({
  default: sharpMock
}))

import { EWebpAnimationStatus } from '@/enums/EWebpAnimationStatus'
import { runWebpAnimationScanJob } from './webp-animation-scan-service'

describe('webp-animation-scan-service', () => {
  beforeEach(() => {
    updateManyMock.mockReset().mockResolvedValue({ count: 0 })
    countMock.mockReset().mockResolvedValue(0)
    findManyMock.mockReset().mockResolvedValue([])
    updateMock.mockReset().mockResolvedValue({})
    metadataMock.mockReset().mockResolvedValue({ pages: 1 })
    sharpMock.mockReset().mockImplementation(() => ({ metadata: metadataMock }))
  })

  it('initializes only null webp images as pending before scanning', async () => {
    updateManyMock.mockResolvedValue({ count: 3 })
    countMock.mockResolvedValue(0)

    const result = await runWebpAnimationScanJob({ scanPath: 'D:/scan-root' })

    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        webpAnimationStatus: null,
        path: { endsWith: '.webp', mode: 'insensitive' }
      },
      data: { webpAnimationStatus: EWebpAnimationStatus.pending }
    })
    expect(result.initialized).toBe(3)
    expect(findManyMock).not.toHaveBeenCalled()
  })

  it('processes pending webp images in batches of 20 and writes static or animated status', async () => {
    const firstBatch = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      path: `/artist/artwork/${index + 1}.webp`
    }))
    const secondBatch = [{ id: 21, path: '/artist/artwork/21.webp' }]

    countMock.mockResolvedValueOnce(21).mockResolvedValueOnce(0)
    findManyMock.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce(secondBatch).mockResolvedValueOnce([])
    metadataMock
      .mockResolvedValueOnce({ pages: 2 })
      .mockResolvedValueOnce({ pages: 1 })
      .mockResolvedValue({ pages: 1 })

    const result = await runWebpAnimationScanJob({ scanPath: 'D:/scan-root' })

    expect(sharpMock).toHaveBeenCalledWith(expect.stringMatching(/[\\/]artist[\\/]artwork[\\/]1\.webp$/), {
      animated: true,
      limitInputPixels: false
    })
    expect(findManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        webpAnimationStatus: EWebpAnimationStatus.pending,
        path: { endsWith: '.webp', mode: 'insensitive' },
        id: { gt: 0 }
      },
      orderBy: { id: 'asc' },
      take: 20,
      select: { id: true, path: true }
    })
    expect(findManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        webpAnimationStatus: EWebpAnimationStatus.pending,
        path: { endsWith: '.webp', mode: 'insensitive' },
        id: { gt: 20 }
      },
      orderBy: { id: 'asc' },
      take: 20,
      select: { id: true, path: true }
    })
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { webpAnimationStatus: EWebpAnimationStatus.animated }
    })
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { webpAnimationStatus: EWebpAnimationStatus.static }
    })
    expect(result).toMatchObject({
      processed: 21,
      animated: 1,
      static: 20,
      failed: 0,
      remainingPending: 0
    })
  })

  it('keeps failed images pending and reports failed samples', async () => {
    countMock.mockResolvedValueOnce(2).mockResolvedValueOnce(1)
    findManyMock
      .mockResolvedValueOnce([
        { id: 1, path: '/artist/artwork/static.webp' },
        { id: 2, path: '/artist/artwork/broken.webp' }
      ])
      .mockResolvedValueOnce([])
    metadataMock.mockResolvedValueOnce({ pages: 1 }).mockRejectedValueOnce(new Error('bad webp'))

    const result = await runWebpAnimationScanJob({ scanPath: 'D:/scan-root' })

    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { webpAnimationStatus: EWebpAnimationStatus.static }
    })
    expect(result).toMatchObject({
      processed: 1,
      static: 1,
      failed: 1,
      remainingPending: 1,
      failedSamples: [{ id: 2, path: '/artist/artwork/broken.webp', error: 'bad webp' }]
    })
  })
})
