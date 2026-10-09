import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@pixishelf/db'
vi.mock('server-only', () => ({}))
import { createArchiveUploaderSource, createArchiveTitleSource } from '../archive-uploader-service'

function setup() {
  const record = { id: 'source', titleQuery: null, defaultCreators: [], lastErrorCode: null, lastErrorMessage: null }
  const create = vi.fn().mockResolvedValue(record)
  const upsert = vi
    .fn()
    .mockResolvedValue({ ...record, titleQuery: { keyword: 'Example', matchMode: 'CONTAINS', uploaderUid: null } })
  const findFirst = vi.fn().mockResolvedValue(null)
  const count = vi.fn().mockResolvedValue(2)
  const tx = {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    artist: { count },
    archiveUploaderSource: { create, upsert, findFirst }
  }
  const transaction = vi.fn(async (operation: (value: typeof tx) => unknown) => operation(tx))
  return { create, upsert, findFirst, count, transaction, deps: { database: { $transaction: transaction } as never } }
}
describe('source creation artist defaults', () => {
  it.each(['uploader', 'keyword'])('validates and atomically creates %s artist defaults', async (kind) => {
    const context = setup()
    if (kind === 'uploader') {
      await createArchiveUploaderSource(
        { identityKind: 'UID', identityValue: '123', artistIds: [9, 7, 7] },
        context.deps
      )
      expect(context.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            defaultCreators: { create: [{ artist: { connect: { id: 7 } } }, { artist: { connect: { id: 9 } } }] }
          })
        })
      )
    } else {
      await createArchiveTitleSource({ displayName: 'Test', keyword: 'Example', artistIds: [9, 7, 7] }, context.deps)
      expect(context.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {},
          create: expect.objectContaining({
            titleQuery: { keyword: 'Example', matchMode: 'CONTAINS', uploaderUid: null },
            defaultCreators: { create: [{ artist: { connect: { id: 7 } } }, { artist: { connect: { id: 9 } } }] }
          })
        })
      )
    }
    expect(context.transaction).toHaveBeenCalledTimes(1)
    expect(context.count).toHaveBeenCalledWith({ where: { id: { in: [7, 9] }, mergedIntoId: null } })
  })
  it.each(['uploader', 'keyword'])('rejects deleted or merged artists before creating %s', async (kind) => {
    const context = setup()
    context.count.mockResolvedValue(1)
    await expect(
      kind === 'uploader'
        ? createArchiveUploaderSource({ identityKind: 'UID', identityValue: '123', artistIds: [7, 9] }, context.deps)
        : createArchiveTitleSource({ displayName: 'Test', keyword: 'Example', artistIds: [7, 9] }, context.deps)
    ).rejects.toThrow('所选艺术家或社团已不存在')
    expect(context.create).not.toHaveBeenCalled()
    expect(context.upsert).not.toHaveBeenCalled()
  })
  it('preserves the original binding when reusing an uploader', async () => {
    const context = setup()
    context.findFirst.mockResolvedValue({
      id: 'existing',
      lastErrorCode: null,
      lastErrorMessage: null,
      defaultCreators: [{ artist: { id: 1, name: 'Original' } }]
    })
    const result = await createArchiveUploaderSource(
      { identityKind: 'UID', identityValue: '123', artistIds: [7, 9] },
      context.deps
    )
    expect(result).toMatchObject({ reused: true, defaultCreators: [{ id: 1, name: 'Original' }] })
    expect(context.create).not.toHaveBeenCalled()
  })
  it('retries a keyword uniqueness race in a fresh transaction', async () => {
    const context = setup()
    context.upsert.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Race', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['queryKey'] }
      })
    )
    await createArchiveTitleSource({ displayName: 'Test', keyword: 'Example', artistIds: [7, 9] }, context.deps)
    expect(context.transaction).toHaveBeenCalledTimes(2)
  })
})
