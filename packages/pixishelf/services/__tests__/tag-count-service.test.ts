import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRawMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { $queryRawUnsafe: queryRawMock }
}))

import { rebuildTagArtworkCounts } from '../tag-count-service'

describe('rebuildTagArtworkCounts', () => {
  beforeEach(() => {
    queryRawMock.mockReset().mockResolvedValue([{ updated_count: BigInt(4) }])
  })

  it('aggregates ArtworkTag once and updates all inconsistent tags as a set', async () => {
    await expect(rebuildTagArtworkCounts()).resolves.toEqual({ updatedTags: 4 })

    const sql = String(queryRawMock.mock.calls[0]?.[0])
    expect(sql.match(/FROM "ArtworkTag"/g)).toHaveLength(1)
    expect(sql).toContain('GROUP BY "tagId"')
    expect(sql).toContain('UPDATE "Tag"')
    expect(sql).toContain('IS DISTINCT FROM counts.artwork_count')
  })
})
