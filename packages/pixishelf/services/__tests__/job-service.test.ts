import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRawMock, findFirstMock, createMock, transactionMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  findFirstMock: vi.fn(),
  createMock: vi.fn(),
  transactionMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock
  }
}))

import { createLocalDirectoryImportJob, createScanJob } from '../job-service'

const tx = {
  $queryRawUnsafe: queryRawMock,
  systemJob: {
    findFirst: findFirstMock,
    create: createMock
  }
}

describe('media scan job locking', () => {
  beforeEach(() => {
    queryRawMock.mockReset().mockResolvedValue([{ pg_advisory_xact_lock: '' }])
    findFirstMock.mockReset().mockResolvedValue(null)
    createMock.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: 'job-1', ...data }))
    transactionMock.mockReset().mockImplementation((callback) => callback(tx))
  })

  it('creates scan and local import jobs under the same advisory lock', async () => {
    await createScanJob()
    await createLocalDirectoryImportJob()

    expect(queryRawMock).toHaveBeenCalledTimes(2)
    expect(queryRawMock.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock($1)::text')
    expect(queryRawMock.mock.calls[0]?.[1]).toBe(queryRawMock.mock.calls[1]?.[1])
  })

  it('rejects a local import while any media scan job is active', async () => {
    findFirstMock.mockResolvedValue({ id: 'scan-job', type: 'SCAN' })

    await expect(createLocalDirectoryImportJob()).rejects.toThrow('Media scan job already in progress')
    expect(createMock).not.toHaveBeenCalled()
  })
})
