import { Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { createArchiveTitleSource } from '../archive-uploader-service'

const input = { displayName: 'New name', keyword: 'Example' }

function databaseError(code: string, target?: unknown) {
  return new Prisma.PrismaClientKnownRequestError('Database error', {
    code,
    clientVersion: '5.22.0',
    meta: target === undefined ? undefined : { target }
  })
}

function setup(error: unknown) {
  const upsert = vi.fn().mockRejectedValue(error)
  const findUnique = vi.fn()
  return { upsert, findUnique, deps: { database: { archiveUploaderSource: { upsert, findUnique } } as never } }
}

describe('title source creation conflict recovery', () => {
  it('reads the winning query without changing its name or disabled state', async () => {
    const { upsert, findUnique, deps } = setup(databaseError('P2002', ['queryKey']))
    findUnique.mockResolvedValue({
      id: 'existing-source',
      sourceKind: 'TITLE_QUERY',
      titleQuery: { keyword: 'example', matchMode: 'CONTAINS', uploaderUid: null },
      displayName: 'Original name',
      status: 'ARCHIVED',
      uploaderUid: null,
      lastSuccessAt: null,
      incrementalCursor: null,
      historyCursor: null,
      lastErrorCode: null,
      lastErrorMessage: null
    })

    await expect(createArchiveTitleSource(input, deps)).resolves.toMatchObject({
      id: 'existing-source',
      displayName: 'Original name',
      status: 'ARCHIVED'
    })
    expect(upsert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ update: {} }))
    const upsertArgs = upsert.mock.calls[0]?.[0]
    expect(findUnique).toHaveBeenCalledExactlyOnceWith({
      where: upsertArgs?.where,
      select: upsertArgs?.select
    })
  })

  it.each([
    ['another unique field', databaseError('P2002', ['uploaderUid'])],
    ['a compound unique key', databaseError('P2002', ['queryKey', 'providerKey'])],
    ['missing constraint metadata', databaseError('P2002')],
    ['ambiguous constraint metadata', databaseError('P2002', 'queryKey')],
    ['another Prisma error', databaseError('P2003', ['queryKey'])],
    ['an untyped error', { code: 'P2002', meta: { target: ['queryKey'] } }],
    ['a connection error', new Error('Connection failed')]
  ])('does not swallow %s', async (_name, error) => {
    const { findUnique, deps } = setup(error)
    await expect(createArchiveTitleSource(input, deps)).rejects.toBe(error)
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('preserves the conflict if its winning source cannot be found', async () => {
    const error = databaseError('P2002', ['queryKey'])
    const { findUnique, deps } = setup(error)
    findUnique.mockResolvedValue(null)
    await expect(createArchiveTitleSource(input, deps)).rejects.toBe(error)
  })

  it('propagates a failure reading the winning source', async () => {
    const { findUnique, deps } = setup(databaseError('P2002', ['queryKey']))
    const readError = new Error('Connection lost')
    findUnique.mockRejectedValue(readError)
    await expect(createArchiveTitleSource(input, deps)).rejects.toBe(readError)
  })
})
