import { Worker } from 'node:worker_threads'
import type { SearchBatch, SearchCursor, SearchPage } from './visual-search-index.ts'

export class VisualSearchWorker {
  private sequence = 0
  private pending: { resolve(value: unknown): void; reject(error: Error): void } | undefined
  readonly worker: Worker
  constructor(entrypoint: string, execArgv?: string[]) {
    this.worker = new Worker(entrypoint, { execArgv, resourceLimits: { maxOldGenerationSizeMb: 128 } })
    this.worker.on('message', (message: { error?: string; value: unknown }) => {
      const pending = this.pending; this.pending = undefined
      if (message.error) pending?.reject(new Error(message.error)); else pending?.resolve(message.value)
    })
    this.worker.on('error', error => { this.pending?.reject((error as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY' ? new Error('VISUAL_INDEX_MEMORY_BUDGET') : error); this.pending = undefined })
    this.worker.on('exit', () => { this.pending?.reject(new Error('Visual search worker exited')); this.pending = undefined })
    this.worker.unref()
  }
  private request<T>(message: object): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve: value => resolve(value as T), reject }
      this.worker.postMessage({ ...message, id: ++this.sequence })
    })
  }
  load(pages: SearchPage[]) { return this.request<void>({ kind: 'LOAD', pages }) }
  build() { return this.request<{ bytes: number; memoryPeakBytes: number; indexMs: number }>({ kind: 'BUILD' }) }
  batch(cursor: SearchCursor, budget: number) { return this.request<SearchBatch>({ kind: 'BATCH', cursor, budget }) }
  async close() { await this.worker.terminate() }
}
