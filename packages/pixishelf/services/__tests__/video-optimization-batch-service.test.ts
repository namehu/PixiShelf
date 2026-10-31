import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), enqueue: vi.fn(), retry: vi.fn(), lock: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock('../video-streaming-optimization-lock', () => ({ lockActiveVideoStreamingOptimization: mocks.lock }))
vi.mock('../background-task/job-command-service', () => ({ enqueueJob: mocks.enqueue, retryJobCommand: mocks.retry }))
import { submitVideoStreamingOptimizationBatch } from '../video-optimization-batch-service'

describe('MP4 batch partial submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lock.mockResolvedValue(null)
  })
  it('continues after a single transaction failure and reports only safe error text', async () => {
    const transaction = {
      image: { findFirst: vi.fn().mockResolvedValue({ id: 2, path: 'safe/video.mp4' }) },
      systemJob: { findFirst: vi.fn().mockResolvedValue(null) }
    }
    mocks.transaction
      .mockRejectedValueOnce(new Error('postgresql://private:secret@localhost/database'))
      .mockImplementationOnce((callback) => callback(transaction))
    mocks.enqueue.mockResolvedValue({ id: 'queued' })
    const result = await submitVideoStreamingOptimizationBatch(
      {
        targets: [
          { imageId: 1, artworkId: 1, latestJobId: null, status: 'NONE' },
          { imageId: 2, artworkId: 1, latestJobId: null, status: 'NONE' }
        ]
      },
      'actor'
    )
    expect(result).toMatchObject({ submitted: 1, reused: 0, skipped: 0, failed: 1 })
    expect(result.items).toEqual([
      { imageId: 1, artworkId: 1, outcome: 'FAILED', reason: '入队失败，请稍后重试' },
      { imageId: 2, artworkId: 1, outcome: 'SUBMITTED', jobId: 'queued' }
    ])
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
  })
})
