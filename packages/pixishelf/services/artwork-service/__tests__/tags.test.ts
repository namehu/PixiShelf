import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  guard: vi.fn(),
  artwork: vi.fn(),
  tags: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  add: vi.fn(),
  associations: vi.fn(),
  transaction: vi.fn()
}))
vi.mock('@pixishelf/db', () => ({ lockCreatorCatalog: mocks.lock }))
vi.mock('@/services/artwork-dedup-write-guard', () => ({ assertArtworkDedupAppWrite: mocks.guard }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))

import { updateArtworkTags } from '../tags'

const tx = {
  artwork: { findFirst: mocks.artwork },
  tag: { findMany: mocks.tags, upsert: mocks.upsert },
  artworkTag: { deleteMany: mocks.remove, createMany: mocks.add, findMany: mocks.associations }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation((callback) => callback(tx))
  mocks.artwork.mockResolvedValue({ id: 42 })
  mocks.tags.mockResolvedValue([{ id: 2 }])
  mocks.upsert.mockResolvedValue({ id: 4 })
  mocks.associations.mockResolvedValue([{ tag: { id: 4, name: '新标签', name_zh: null } }])
})

describe('detail tag edits', () => {
  it('locks before writes, removes explicit associations of every provenance and only adds MANUAL', async () => {
    const result = await updateArtworkTags({
      artworkId: 42,
      addTagIds: [2],
      removeTagIds: [3],
      newTagNames: ['新标签']
    })
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.lock).toHaveBeenCalledWith(tx)
    expect(mocks.guard).toHaveBeenCalledWith(tx, 42, 'STRUCTURE')
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.guard.mock.invocationCallOrder[0]!)
    expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(mocks.artwork.mock.invocationCallOrder[0]!)
    expect(mocks.artwork).toHaveBeenCalledWith({
      where: { id: 42, deletedAt: null, archiveLifecycleState: 'ACTIVE' },
      select: { id: true }
    })
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { namespace_name: { namespace: 'general', name: '新标签' } },
      create: { namespace: 'general', name: '新标签' },
      update: {},
      select: { id: true }
    })
    expect(mocks.remove).toHaveBeenCalledWith({ where: { artworkId: 42, tagId: { in: [3] } } })
    expect(mocks.add).toHaveBeenCalledWith({
      data: [
        { artworkId: 42, tagId: 2, provenance: 'MANUAL' },
        { artworkId: 42, tagId: 4, provenance: 'MANUAL' }
      ],
      skipDuplicates: true
    })
    expect(result).toEqual([{ id: 4, name: '新标签', name_zh: null }])
  })

  it('deduplicates an existing ID also resolved from a new name', async () => {
    mocks.upsert.mockResolvedValue({ id: 2 })
    await updateArtworkTags({ artworkId: 42, addTagIds: [2], removeTagIds: [], newTagNames: ['已存在'] })
    expect(mocks.add).toHaveBeenCalledWith({
      data: [{ artworkId: 42, tagId: 2, provenance: 'MANUAL' }],
      skipDuplicates: true
    })
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('rejects non-active and deleted works before creating tags', async () => {
    mocks.artwork.mockResolvedValue(null)
    await expect(
      updateArtworkTags({ artworkId: 42, addTagIds: [], removeTagIds: [], newTagNames: ['新标签'] })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('rejects missing added IDs before any mutations', async () => {
    mocks.tags.mockResolvedValue([])
    await expect(
      updateArtworkTags({ artworkId: 42, addTagIds: [2], removeTagIds: [3], newTagNames: ['新标签'] })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('lets the transaction reject a name that resolves to an explicitly removed tag', async () => {
    mocks.upsert.mockResolvedValue({ id: 3 })
    await expect(
      updateArtworkTags({ artworkId: 42, addTagIds: [], removeTagIds: [3], newTagNames: ['同一标签'] })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('stops at the maintenance guard without writing', async () => {
    mocks.guard.mockRejectedValue(new Error('maintenance'))
    await expect(
      updateArtworkTags({ artworkId: 42, addTagIds: [2], removeTagIds: [], newTagNames: [] })
    ).rejects.toThrow('maintenance')
    expect(mocks.artwork).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })
})
