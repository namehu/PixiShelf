import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lock: vi.fn(), read: vi.fn(), find: vi.fn(), update: vi.fn(), mapping: vi.fn(), createMapping: vi.fn()
}))
vi.mock('server-only', () => ({}))
vi.mock('@pixishelf/db', async (original) => ({
  ...await original<typeof import('@pixishelf/db')>(),
  lockCreatorCatalog: mocks.lock,
  lockArtworkForReading: mocks.read
}))
const tx = {
  artwork: { findUnique: mocks.find, update: mocks.update },
  localImportArtistMapping: { findUnique: mocks.mapping, create: mocks.createMapping }
}
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: async (run: (client: unknown) => unknown) => run(tx) } }))
import { assignManualArtworkStorage, ensureManualArtworkStorage } from '../manual-storage'
import { determineArtworkRelDir } from '../utils'
import type { Prisma } from '@prisma/client'

const emptyWork = {
  id: 83, artistId: null, storageKey: 'e_83_1544954', storagePath: null,
  createdVia: 'MANUAL_CREATE', metaSource: null, _count: { images: 0 }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.read.mockResolvedValue({ id: 83 })
  mocks.find.mockResolvedValue(emptyWork)
  mocks.mapping.mockResolvedValue(null)
  mocks.update.mockImplementation(async ({ data }) => ({ ...emptyWork, ...data }))
})

describe('manual artwork upload storage', () => {
  it('persists a directory for a new work without an artist that upload path resolution can use', async () => {
    const work = await assignManualArtworkStorage(tx as unknown as Prisma.TransactionClient, emptyWork)
    expect(determineArtworkRelDir(work)).toBe('local-imports/unassigned/e_83_1544954')
    expect(mocks.createMapping).not.toHaveBeenCalled()
  })

  it('repairs an existing empty manual work while retaining its storage key', async () => {
    await ensureManualArtworkStorage(83)
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 83 }, data: { storageKey: emptyWork.storageKey, storagePath: 'local-imports/unassigned/e_83_1544954' }
    })
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[0]!)
    expect(mocks.read.mock.invocationCallOrder[0]).toBeLessThan(mocks.find.mock.invocationCallOrder[0]!)
  })

  it('registers the artist directory for a work with a primary artist', async () => {
    await assignManualArtworkStorage(tx as unknown as Prisma.TransactionClient, { ...emptyWork, artistId: 7 })
    expect(mocks.createMapping).toHaveBeenCalledWith({ data: { artistDirectory: 'artist-7', artistId: 7 } })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { storageKey: emptyWork.storageKey, storagePath: 'local-imports/artist-7/e_83_1544954' }
    }))
  })

  it.each([
    { storagePath: 'preserved/work' }, { _count: { images: 1 } },
    { createdVia: 'URL_ARCHIVE' }, { metaSource: 'legacy/meta.json' }
  ])('does not allocate a new directory over existing or non-manual data: %j', async (fields) => {
    mocks.find.mockResolvedValue({ ...emptyWork, ...fields })
    await ensureManualArtworkStorage(83)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects an artist mapping collision before persisting a path', async () => {
    mocks.mapping.mockResolvedValue({ artistId: 8 })
    await expect(assignManualArtworkStorage(tx as unknown as Prisma.TransactionClient, { ...emptyWork, artistId: 7 })).rejects.toThrow('已绑定')
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
