import type { Prisma } from '@pixishelf/db'
import type { JobDiagnosticInput } from '@pixishelf/job-contracts'
import type { ExecutionProgressUpdate } from '@pixishelf/job-runtime'
import type { ArchiveExecutorContext, LoadedArchiveImport } from './executor.ts'
import type { ArchiveTransaction } from './types.ts'
import { assertArchiveDownloadGeneration } from './dedup-source-snapshot.ts'
import { ArchiveExecutorError, isRetryableArchiveTransaction } from './errors.ts'

export const DOWNLOAD_SAVE_INTERVAL_MS = 5_000
export const DOWNLOAD_SAVE_ITEM_COUNT = 10

type PendingItem = {
  data: Prisma.ArchiveImportItemUpdateManyMutationInput
  diagnostic?: JobDiagnosticInput
}

/** Only committed batches leave this map. Downloads keep their newer changes while a batch is saving. */
export class ArchiveDownloadCheckpoints {
  private readonly pending = new Map<string, PendingItem>()
  private tail: Promise<void> = Promise.resolve()
  private failure: unknown

  constructor(
    private readonly context: ArchiveExecutorContext,
    private readonly archiveImport: LoadedArchiveImport
  ) {}

  set(id: string, data: PendingItem['data'], diagnostic?: JobDiagnosticInput) {
    const previous = this.pending.get(id)
    this.pending.set(id, { data: { ...previous?.data, ...data }, ...(diagnostic ? { diagnostic } : {}) })
  }

  async saveIfFull(update: () => ExecutionProgressUpdate): Promise<void> {
    if (this.failure) throw this.failure
    const finished = [...this.pending.values()].filter(
      ({ data }) => data.status === 'COMPLETED' || data.status === 'FAILED'
    ).length
    if (finished >= DOWNLOAD_SAVE_ITEM_COUNT) await this.save(update)
  }

  save(update: () => ExecutionProgressUpdate): Promise<void> {
    const operation = this.tail.then(async () => {
      if (this.failure) throw this.failure
      const batch = new Map(this.pending)
      const progress = update()
      const write = async (transaction: ArchiveTransaction) => {
        await this.write(transaction, batch)
        return { result: undefined, update: { ...progress, progressData: null } }
      }
      // Retry only known rolled-back/never-started transactions; files and network I/O are outside this callback.
      for (let attempt = 0; ; attempt += 1) {
        try {
          if (this.context.checkpointInTransaction) await this.context.checkpointInTransaction(write)
          else {
            await this.context.mutateInTransaction(write)
            await this.context.progress(progress)
          }
          break
        } catch (error) {
          if (attempt >= 2 || !isRetryableArchiveTransaction(error)) throw error
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
        }
      }
      this.acknowledge(batch)
    })
    this.tail = operation.catch((error) => {
      this.failure = error
    })
    return operation
  }

  /** Called after all streams stop, inside the existing pause/cancel/failure transaction. */
  async saveOnStop(transaction: ArchiveTransaction): Promise<void> {
    await this.tail
    if (this.pending.size) await this.write(transaction, new Map(this.pending), true)
  }

  private async write(transaction: ArchiveTransaction, batch: Map<string, PendingItem>, stopping = false) {
    try {
      await assertArchiveDownloadGeneration(transaction, {
        archiveImport: this.archiveImport,
        jobId: this.context.job.id,
        token: this.context.job.executionToken,
        stopping
      })
    } catch (error) {
      // A changed/removed source cannot receive results, but must still be allowed to stop.
      if (stopping && error instanceof ArchiveExecutorError && error.code === 'STATE_CONFLICT') return
      throw error
    }
    if (batch.size === 0) return
    for (const [id, item] of batch) {
      const changed = await transaction.archiveImportItem.updateMany({
        where: { id, archiveImportId: this.archiveImport.id },
        data:
          stopping && item.data.status === 'DOWNLOADING'
            ? { ...item.data, status: 'PENDING', finishedAt: null }
            : item.data
      })
      if (changed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', '归档图片在保存前已变化')
      if (item.diagnostic) await this.context.recordDiagnostic?.(transaction, item.diagnostic)
    }
    const groups = await transaction.archiveImportItem.groupBy({
      by: ['status'],
      where: { archiveImportId: this.archiveImport.id },
      _count: { _all: true }
    })
    await transaction.archiveImport.update({
      where: { id: this.archiveImport.id },
      data: {
        completedItems: groups.find((group) => group.status === 'COMPLETED')?._count._all ?? 0,
        failedItems: groups.find((group) => group.status === 'FAILED')?._count._all ?? 0
      }
    })
  }

  private acknowledge(batch: Map<string, PendingItem>) {
    for (const [id, item] of batch) if (this.pending.get(id) === item) this.pending.delete(id)
  }
}
