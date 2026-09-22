import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { artistMergeBlockers } from '../artist-merge'

describe('artist merge discovery batch blockers', () => {
  it.each(['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'])(
    'blocks a %s discovery batch before it creates child scan snapshots',
    async (status) => {
      const findMany = vi.fn().mockResolvedValue([
        {
          id: 'batch',
          type: 'ARCHIVE_DISCOVERY_BATCH_SCAN',
          status,
          payload: { sources: [{ id: 'source' }] },
          archiveUploaderScanRun: null
        }
      ])
      const tx = { systemJob: { findMany } } as unknown as Prisma.TransactionClient
      const blockers = await artistMergeBlockers(tx, [8, 9])
      expect(blockers).toEqual([
        expect.objectContaining({ jobId: 'batch', type: 'ARCHIVE_DISCOVERY_BATCH_SCAN', status })
      ])
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: { in: expect.arrayContaining([status]) } } })
      )
    }
  )
})
