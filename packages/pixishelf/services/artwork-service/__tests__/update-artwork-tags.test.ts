import { beforeEach, describe, expect, it, vi } from 'vitest'

const { artworkFindUniqueOrThrow, artworkUpdate, artworkTagDeleteMany, artworkTagCreateMany, prismaMock } = vi.hoisted(
  () => {
    const artworkFindUniqueOrThrow = vi.fn()
    const artworkUpdate = vi.fn()
    const artworkTagDeleteMany = vi.fn()
    const artworkTagCreateMany = vi.fn()
    const tx = {
      $queryRaw: vi.fn(),
      artwork: { findUniqueOrThrow: artworkFindUniqueOrThrow, update: artworkUpdate },
      artworkTag: { deleteMany: artworkTagDeleteMany, createMany: artworkTagCreateMany }
    }
    return {
      artworkFindUniqueOrThrow,
      artworkUpdate,
      artworkTagDeleteMany,
      artworkTagCreateMany,
      prismaMock: { ...tx, $transaction: vi.fn((operation: (client: typeof tx) => unknown) => operation(tx)) }
    }
  }
)

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/like-service', () => ({ getUserArtworkLikeStatus: vi.fn() }))

import { updateArtwork } from '..'

describe('updateArtwork tag provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    artworkFindUniqueOrThrow.mockResolvedValue({ title: 'work', description: 'description' })
    artworkUpdate.mockResolvedValue({ id: 42, title: 'work' })
    artworkTagDeleteMany.mockResolvedValue({ count: 1 })
    artworkTagCreateMany.mockResolvedValue({ count: 1 })
  })

  it('keeps source tags and inserts submitted manual tags with duplicate skipping in one transaction', async () => {
    await updateArtwork(42, { title: 'updated', tags: [1, 2] })

    expect(artworkUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: expect.objectContaining({ title: 'updated', titleOverridden: true })
    })
    expect(artworkTagDeleteMany).toHaveBeenCalledWith({
      where: { artworkId: 42, provenance: { in: ['MANUAL', 'LEGACY'] } }
    })
    expect(artworkTagCreateMany).toHaveBeenCalledWith({
      data: [
        { artworkId: 42, tagId: 1, provenance: 'MANUAL' },
        { artworkId: 42, tagId: 2, provenance: 'MANUAL' }
      ],
      skipDuplicates: true
    })
  })

  it('does not create text overrides when the submitted values did not change', async () => {
    await updateArtwork(42, { title: 'work', description: 'description' })

    expect(artworkUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { title: 'work', description: 'description' }
    })
  })

  it('marks only text fields whose values actually changed', async () => {
    await updateArtwork(42, { title: 'work', description: 'new description' })

    expect(artworkUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        title: 'work',
        description: 'new description',
        descriptionOverridden: true
      }
    })
  })
})
