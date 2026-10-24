import {
  MaintenanceSourceError,
  maintenanceSourceErrorCodes,
  type MaintenanceSourceResult
} from './maintenance-source.ts'
import { isReaderOwner, type DedupReaderOwner } from './reader-owner.ts'
import { spawn, type ChildProcess } from 'node:child_process'
import type { ContentFileInspection } from '../media-content/file-reader.ts'
import type { MediaContentReader } from '../media-content/artwork-fingerprint.ts'
import { MediaContentFileError } from '../media-content/roots.ts'
import { ARTWORK_DEDUP_LIMITS as limits } from './limits.ts'
import {
  isExclusiveReaderOperation,
  type DedupRead,
  type DedupRoots,
  type ReaderOperation,
  type ReaderResponse
} from './reader-protocol.ts'
import {
  MaintenanceFileError,
  maintenanceFileErrorCodes,
  type MaintenanceInspection,
  type MaintenanceDirectoryPage,
  type MaintenanceFilesystemCapability
} from './maintenance-files.ts'

export class DedupReaderError extends Error {
  constructor(
    readonly code: 'READER_STALLED' | 'READER_CLOSE_FAILED' | 'READER_ENVIRONMENT' | 'READER_BUSY',
    options?: ErrorOptions
  ) {
    super(code, options)
    this.name = 'DedupReaderError'
  }
}
export interface ReaderMetrics {
  inspections: number
  reads: number
  bytesRead: bigint
  statLatencyMs: number
  parentPeakRss: number
  childPeakRss: number
  ipcMessages: number
}
interface Pending {
  operation: ReaderOperation
  signal: AbortSignal
  abort: () => void
  startedAt: number
  lastProgress: number
  bytes: bigint
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}
export interface DedupReaderOptions {
  /** Fixed executable from the Worker build, never a payload-provided path. */
  entrypoint: string
  execArgv?: string[]
  stallMs?: number
  closeMs?: number
  spawnProcess?: () => ChildProcess
  now?: () => number
}

/** One supervisor is shared by all executions in a Worker. An unclosed child poisons it. */
export class DedupReaderSupervisor {
  private active: ControlledDedupReader | undefined
  private fault: Error | undefined
  constructor(private readonly options: DedupReaderOptions) {}
  create(): ControlledDedupReader {
    if (this.fault) throw this.fault
    if (this.active) throw new DedupReaderError('READER_BUSY')
    const reader = new ControlledDedupReader(this.options, (error) => {
      if (error) this.fault = error
      else if (this.active === reader) this.active = undefined
    })
    this.active = reader
    return reader
  }
}

export class ControlledDedupReader implements MediaContentReader {
  onProgress: ((metrics: Readonly<ReaderMetrics>) => void) | undefined
  readonly metrics: ReaderMetrics = {
    inspections: 0,
    reads: 0,
    bytesRead: 0n,
    statLatencyMs: 0,
    parentPeakRss: 0,
    childPeakRss: 0,
    ipcMessages: 0
  }
  private child: ChildProcess | undefined
  private pending = new Map<number, Pending>()
  private nextId = 0
  private stopReason: Error | undefined
  private closed = false
  private closing: Promise<void> | undefined
  private resolveClose: (() => void) | undefined
  private rejectClose: ((error: Error) => void) | undefined
  private closeTimer: NodeJS.Timeout | undefined
  private watchdog: NodeJS.Timeout | undefined
  private startup: Promise<DedupReaderOwner> | undefined
  private resolveStartup: ((owner: DedupReaderOwner) => void) | undefined
  private rejectStartup: ((error: Error) => void) | undefined
  private startupTimer: NodeJS.Timeout | undefined
  private readonly now: () => number
  constructor(
    private readonly options: DedupReaderOptions,
    private readonly onClosed: (error?: Error) => void
  ) {
    this.now = options.now ?? Date.now
  }
  start(signal?: AbortSignal): Promise<DedupReaderOwner> {
    if (signal?.aborted) return Promise.reject(abortError(signal))
    if (!this.startup) {
      this.startup = new Promise((resolve, reject) => {
        this.resolveStartup = resolve
        this.rejectStartup = reject
      })
      this.startupTimer = setTimeout(() => {
        void this.close(new DedupReaderError('READER_STALLED')).catch(() => undefined)
      }, this.options.stallMs ?? limits.stallMs)
      const abort = () => {
        void this.close(abortError(signal!)).catch(() => undefined)
      }
      signal?.addEventListener('abort', abort, { once: true })
      void this.startup.then(
        () => signal?.removeEventListener('abort', abort),
        () => signal?.removeEventListener('abort', abort)
      )
      try {
        this.ensureChild()
      } catch (error) {
        void this.close(new DedupReaderError('READER_ENVIRONMENT', { cause: error })).catch(() => undefined)
      }
    }
    return this.startup
  }
  resolveRoots(input: Extract<ReaderOperation, { operation: 'roots' }>, signal: AbortSignal): Promise<DedupRoots> {
    return this.request(input, signal) as Promise<DedupRoots>
  }
  inspect(input: Parameters<MediaContentReader['inspect']>[0]): Promise<ContentFileInspection> {
    return this.request(
      { operation: 'inspect', root: input.root, relativePath: input.relativePath },
      input.signal
    ) as Promise<ContentFileInspection>
  }
  read(input: Parameters<MediaContentReader['read']>[0]): Promise<DedupRead> {
    return this.request(
      { operation: 'read', root: input.root, relativePath: input.relativePath },
      input.signal
    ) as Promise<DedupRead>
  }
  inspectMaintenance(
    input: Omit<Extract<ReaderOperation, { operation: 'inspect' | 'read' | 'maintenance-inspect' }>, 'operation'> & {
      signal: AbortSignal
    }
  ): Promise<MaintenanceInspection> {
    return this.request(
      { operation: 'maintenance-inspect', root: input.root, relativePath: input.relativePath },
      input.signal
    ) as Promise<MaintenanceInspection>
  }
  inspectDirectory(
    input: Omit<Extract<ReaderOperation, { operation: 'maintenance-directory' }>, 'operation'> & { signal: AbortSignal }
  ): Promise<MaintenanceDirectoryPage> {
    const { signal, ...request } = input
    return this.request({ operation: 'maintenance-directory', ...request }, signal) as Promise<MaintenanceDirectoryPage>
  }
  inspectSource(
    input: Omit<Extract<ReaderOperation, { operation: 'maintenance-source' }>, 'operation'> & { signal: AbortSignal }
  ): Promise<MaintenanceSourceResult> {
    const { signal, ...request } = input
    return this.request({ operation: 'maintenance-source', ...request }, signal) as Promise<MaintenanceSourceResult>
  }
  probeFilesystem(
    input: Omit<Extract<ReaderOperation, { operation: 'maintenance-capability' }>, 'operation'> & {
      signal: AbortSignal
    }
  ): Promise<MaintenanceFilesystemCapability> {
    const { signal, ...request } = input
    return this.request(
      { operation: 'maintenance-capability', ...request },
      signal
    ) as Promise<MaintenanceFilesystemCapability>
  }
  deleteFile(input: Omit<Extract<ReaderOperation,{operation:'direct-delete'}>,'operation'> & {signal:AbortSignal}): Promise<import('./maintenance-files.ts').DirectDeleteFileReceipt> {
    const {signal,...request}=input
    return this.request({operation:'direct-delete',...request},signal) as Promise<import('./maintenance-files.ts').DirectDeleteFileReceipt>
  }
  close(reason = new Error('Reader closed')): Promise<void> {
    if (this.closing) return this.closing
    this.stopReason = reason
    this.closing = new Promise<void>((resolve, reject) => {
      this.resolveClose = resolve
      this.rejectClose = reject
    })
    // The caller may be waiting for an in-flight request rather than close().
    void this.closing.catch(() => undefined)
    if (!this.child || this.closed) {
      this.finishClose()
      return this.closing
    }
    this.closeTimer = setTimeout(() => {
      const error = new DedupReaderError('READER_CLOSE_FAILED')
      this.stopReason = error
      this.rejectStartup?.(error)
      this.rejectPending(error)
      clearInterval(this.watchdog)
      this.onClosed(error)
      this.rejectClose?.(error)
    }, this.options.closeMs ?? limits.closeMs)
    this.child.kill('SIGKILL')
    return this.closing
  }
  private request(operation: ReaderOperation, signal: AbortSignal): Promise<unknown> {
    if (this.stopReason || this.closed)
      return Promise.reject(this.stopReason ?? new DedupReaderError('READER_ENVIRONMENT'))
    if (signal.aborted) return Promise.reject(abortError(signal))
    if (
      this.pending.size >= limits.statConcurrency ||
      (operation.operation === 'read' && [...this.pending.values()].some((p) => p.operation.operation === 'read'))
    )
      return Promise.reject(new DedupReaderError('READER_BUSY'))
    if (
      [...this.pending.values()].some((p) => isExclusiveReaderOperation(p.operation.operation)) ||
      (isExclusiveReaderOperation(operation.operation) && this.pending.size > 0)
    )
      return Promise.reject(new DedupReaderError('READER_BUSY'))
    const child = this.ensureChild()
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const abort = () => {
        void this.close(abortError(signal)).catch(() => undefined)
      }
      this.pending.set(id, {
        operation,
        signal,
        abort,
        startedAt: this.now(),
        lastProgress: this.now(),
        bytes: 0n,
        resolve,
        reject
      })
      signal.addEventListener('abort', abort, { once: true })
      try {
        child.send({ ...operation, type: 'request', id }, (error) => {
          if (error)
            void this.close(new DedupReaderError('READER_ENVIRONMENT', { cause: error })).catch(() => undefined)
        })
      } catch (error) {
        void this.close(new DedupReaderError('READER_ENVIRONMENT', { cause: error })).catch(() => undefined)
      }
    })
  }
  private ensureChild(): ChildProcess {
    if (this.child) return this.child
    const child =
      this.options.spawnProcess?.() ??
      spawn(process.execPath, [...(this.options.execArgv ?? []), this.options.entrypoint], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        serialization: 'advanced',
        // Reader has no DB/network work and receives only fixed structured requests.
        env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV }
      })
    this.child = child
    child.on('message', (message: unknown) => this.handleMessage(message))
    child.once('error', () => {
      void this.close(new DedupReaderError('READER_ENVIRONMENT')).catch(() => undefined)
    })
    child.once('close', () => {
      this.closed = true
      this.stopReason ??= new DedupReaderError('READER_ENVIRONMENT')
      this.finishClose()
    })
    this.watchdog = setInterval(
      () => {
        if (
          [...this.pending.values()].some(
            (p) => this.now() - p.lastProgress >= (this.options.stallMs ?? limits.stallMs)
          )
        )
          void this.close(new DedupReaderError('READER_STALLED')).catch(() => undefined)
      },
      Math.min(250, this.options.stallMs ?? limits.stallMs)
    )
    this.watchdog.unref()
    return child
  }
  private handleMessage(value: unknown) {
    if (this.stopReason || !value || typeof value !== 'object') return
    if ('type' in value && value.type === 'ready' && 'owner' in value && isReaderOwner(value.owner)) {
      clearTimeout(this.startupTimer)
      this.resolveStartup?.(value.owner)
      return
    }
    const message = value as ReaderResponse
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.metrics.ipcMessages++
    this.metrics.parentPeakRss = Math.max(this.metrics.parentPeakRss, process.memoryUsage().rss)
    if (Number.isFinite(message.rss)) this.metrics.childPeakRss = Math.max(this.metrics.childPeakRss, message.rss)
    if (message.type === 'progress' && typeof message.bytesRead === 'bigint' && message.bytesRead > pending.bytes) {
      this.metrics.bytesRead += message.bytesRead - pending.bytes
      pending.bytes = message.bytesRead
      pending.lastProgress = this.now()
      this.child?.send({ type: 'ack', id: message.id }, () => undefined)
      this.onProgress?.(this.metrics)
      return
    }
    if (message.type !== 'error' && message.type !== 'result') return
    this.pending.delete(message.id)
    pending.signal.removeEventListener('abort', pending.abort)
    if (message.type === 'error') {
      if (typeof message.bytesRead !== 'bigint' || message.bytesRead < pending.bytes) {
        pending.reject(new DedupReaderError('READER_ENVIRONMENT'))
        void this.close().catch(() => undefined)
        return
      }
      this.metrics.bytesRead += message.bytesRead - pending.bytes
      this.onProgress?.(this.metrics)
      const codes = ['ROOT_CHANGED', 'UNSAFE_PATH', 'NOT_READABLE', 'INVALID_FILE', 'FILE_CHANGED'] as const
      const code = codes.find((code) => code === message.code)
      const maintenanceCode = maintenanceFileErrorCodes.find((code) => code === message.code)
      const sourceCode = maintenanceSourceErrorCodes.find((code) => code === message.code)
      const error = code
        ? new MediaContentFileError(code, code)
        : maintenanceCode
          ? new MaintenanceFileError(maintenanceCode)
          : sourceCode
            ? new MaintenanceSourceError(sourceCode)
            : new DedupReaderError('READER_ENVIRONMENT')
      if ((!code && !maintenanceCode && !sourceCode) || code === 'ROOT_CHANGED')
        void this.close(error).catch(() => undefined)
      pending.reject(error)
      return
    }
    if (pending.operation.operation === 'inspect' || pending.operation.operation === 'maintenance-inspect') {
      this.metrics.inspections++
      this.metrics.statLatencyMs += this.now() - pending.startedAt
    }
    if (pending.operation.operation === 'read' || pending.operation.operation === 'maintenance-source') {
      const result = message.value as DedupRead
      if (typeof result.bytesRead !== 'bigint' || result.bytesRead < pending.bytes) {
        pending.reject(new DedupReaderError('READER_ENVIRONMENT'))
        void this.close().catch(() => undefined)
        return
      }
      this.metrics.reads++
      this.metrics.bytesRead += result.bytesRead - pending.bytes
    }
    this.onProgress?.(this.metrics)
    pending.resolve(message.value)
  }
  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      pending.signal.removeEventListener('abort', pending.abort)
      pending.reject(error)
    }
    this.pending.clear()
  }
  private finishClose() {
    clearInterval(this.watchdog)
    clearTimeout(this.closeTimer)
    this.closed = true
    clearTimeout(this.startupTimer)
    this.rejectStartup?.(this.stopReason ?? new DedupReaderError('READER_ENVIRONMENT'))
    this.rejectPending(this.stopReason ?? new DedupReaderError('READER_ENVIRONMENT'))
    this.onClosed()
    this.resolveClose?.()
  }
}
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Content inspection interrupted')
}
