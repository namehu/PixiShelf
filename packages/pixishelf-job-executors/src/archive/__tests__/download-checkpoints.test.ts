import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArchiveExecutorContext, LoadedArchiveImport } from '../executor.ts'
import { ArchiveDownloadCheckpoints } from '../download-checkpoints.ts'

vi.mock('../dedup-source-snapshot.ts', () => ({ assertArchiveDownloadGeneration: vi.fn() }))
afterEach(() => vi.useRealTimers())

function fixture() {
  const rows = new Map<string, Record<string, unknown>>()
  const transaction = {
    archiveImportItem: {
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        rows.set(where.id, { ...rows.get(where.id), ...data })
        return { count: 1 }
      }),
      groupBy: vi.fn(async () => [])
    },
    archiveImport: { update: vi.fn() }
  }
  const checkpoint = vi.fn(async (write: (tx: typeof transaction) => Promise<unknown>) => write(transaction))
  const context = { job: { id: 'job', executionToken: 'token' }, checkpointInTransaction: checkpoint }
  const buffer = new ArchiveDownloadCheckpoints(
    context as unknown as ArchiveExecutorContext,
    { id: 'archive' } as LoadedArchiveImport
  )
  return { buffer, rows, checkpoint, transaction }
}

describe('archive download batch saves', () => {
  it('retains a completion that arrives while an earlier snapshot is being committed', async () => {
    const { buffer, rows, checkpoint, transaction } = fixture()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    checkpoint.mockImplementationOnce(async (write) => {
      await gate
      return write(transaction)
    })
    buffer.set('image', { status: 'DOWNLOADING', attempts: 1 })
    const first = buffer.save(() => ({ progress: 0 }))
    await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledOnce())
    buffer.set('image', { status: 'COMPLETED', stagedPath: 'media/image.jpg' })
    release()
    await first
    expect(rows.get('image')?.status).toBe('DOWNLOADING')
    await buffer.save(() => ({ progress: 90 }))
    expect(rows.get('image')).toMatchObject({ status: 'COMPLETED', attempts: 1, stagedPath: 'media/image.jpg' })
  })

  it('retries a transaction that never started without dropping the buffered results', async () => {
    vi.useFakeTimers()
    const { buffer, rows, checkpoint } = fixture()
    checkpoint.mockRejectedValueOnce(
      Object.assign(new Error('Unable to start a transaction in the given time.'), { code: 'P2028' })
    )
    buffer.set('image', { status: 'COMPLETED', attempts: 1 })
    const saving = buffer.save(() => ({ progress: 90 }))
    await vi.advanceTimersByTimeAsync(150)
    await saving
    expect(rows.get('image')).toMatchObject({ status: 'COMPLETED', attempts: 1 })
    expect(checkpoint).toHaveBeenCalledTimes(2)
  })
})
