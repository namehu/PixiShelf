import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRandomIds } from '../dao'

const { artworkAggregateMock, artworkFindManyMock } = vi.hoisted(() => ({
  artworkAggregateMock: vi.fn(),
  artworkFindManyMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: {
      aggregate: artworkAggregateMock,
      findMany: artworkFindManyMock
    }
  }
}))

describe('fetchRandomIds', () => {
  beforeEach(() => {
    artworkAggregateMock.mockReset()
    artworkFindManyMock.mockReset()
    vi.spyOn(Math, 'random').mockReturnValue(0.41)
  })

  it('reads an indexed ID window instead of sorting the complete artwork table randomly', async () => {
    artworkAggregateMock.mockResolvedValue({ _min: { id: 1 }, _max: { id: 100 } })
    artworkFindManyMock.mockResolvedValue([{ id: 42 }, { id: 43 }])

    await expect(fetchRandomIds(2)).resolves.toEqual([42, 43])

    expect(artworkFindManyMock).toHaveBeenCalledTimes(1)
    expect(artworkFindManyMock).toHaveBeenCalledWith({
      where: { id: { gte: 42 } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 2
    })
  })

  it('wraps around the ID range and keeps the tag filter on both bounded reads', async () => {
    artworkAggregateMock.mockResolvedValue({ _min: { id: 1 }, _max: { id: 100 } })
    artworkFindManyMock.mockResolvedValueOnce([{ id: 99 }]).mockResolvedValueOnce([{ id: 2 }])

    await expect(fetchRandomIds(2, ['cat'])).resolves.toEqual([99, 2])

    const tagWhere = {
      artworkTags: {
        some: {
          tag: {
            name: { in: ['cat'] }
          }
        }
      }
    }
    expect(artworkAggregateMock).toHaveBeenCalledWith({ _min: { id: true }, _max: { id: true } })
    expect(artworkFindManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { ...tagWhere, id: { gte: 42 } }, take: 2 })
    )
    expect(artworkFindManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { ...tagWhere, id: { lt: 42 } }, take: 1 })
    )
  })
})
