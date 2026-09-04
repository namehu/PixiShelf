import { spawn, type ChildProcess } from 'node:child_process'

export const SHARP_ANIMATION_PROBE_TIMEOUT_SECONDS = 60
const SHARP_ANIMATION_PROBE_HARD_TIMEOUT_GRACE_MS = 500
const SHARP_INPUT_PIXEL_LIMIT = 268_402_689

const SHARP_PROBE_CHILD_SOURCE = String.raw`
'use strict'

const sharp = require('sharp')

sharp.cache(false)
sharp.concurrency(1)

process.on('disconnect', () => process.exit(0))
process.on('message', async (request) => {
  if (!request || request.type !== 'probe' || !Number.isSafeInteger(request.id)) return
  try {
    const { info } = await sharp(request.absolutePath, {
      animated: true,
      failOn: 'error',
      limitInputPixels: ${SHARP_INPUT_PIXEL_LIMIT},
      sequentialRead: true
    })
      .resize({ width: 1, withoutEnlargement: true })
      .raw()
      .timeout({ seconds: request.timeoutSeconds })
      .toBuffer({ resolveWithObject: true })
    if (process.connected) {
      process.send({ type: 'result', id: request.id, ok: true, pages: info.pages ?? 1 }, () => undefined)
    }
  } catch (error) {
    if (process.connected) {
      process.send(
        {
          type: 'result',
          id: request.id,
          ok: false,
          code: error && typeof error.code === 'string' ? error.code : undefined,
          message: error instanceof Error ? error.message : 'Sharp animation probe failed'
        },
        () => undefined
      )
    }
  }
})
`

interface ProbeRequest {
  type: 'probe'
  id: number
  absolutePath: string
  timeoutSeconds: number
}

interface ProbeResponse {
  type: 'result'
  id: number
  ok: boolean
  pages?: number
  code?: string
  message?: string
}

interface PendingProbe {
  id: number
  signal: AbortSignal
  onAbort: () => void
  timer: NodeJS.Timeout
  resolve: (animated: boolean) => void
  reject: (error: Error) => void
  exitError?: Error
}

interface ProbeWaiter {
  signal: AbortSignal
  onAbort: () => void
  resolve: (process: SharpProbeProcess) => void
  reject: (error: Error) => void
}

export interface IsolatedSharpAnimationProbePoolOptions {
  size: number
  timeoutSeconds?: number
  hardTimeoutMs?: number
  childSource?: string
  spawnProcess?: (source: string) => ChildProcess
}

export class IsolatedSharpAnimationProbePool {
  private readonly processes: SharpProbeProcess[]
  private readonly idle: SharpProbeProcess[]
  private readonly waiters: ProbeWaiter[] = []
  private closed = false

  constructor(options: IsolatedSharpAnimationProbePoolOptions) {
    this.processes = Array.from(
      { length: options.size },
      () =>
        new SharpProbeProcess({
          timeoutSeconds: options.timeoutSeconds ?? SHARP_ANIMATION_PROBE_TIMEOUT_SECONDS,
          hardTimeoutMs:
            options.hardTimeoutMs ??
            (options.timeoutSeconds ?? SHARP_ANIMATION_PROBE_TIMEOUT_SECONDS) * 1_000 +
              SHARP_ANIMATION_PROBE_HARD_TIMEOUT_GRACE_MS,
          childSource: options.childSource ?? SHARP_PROBE_CHILD_SOURCE,
          spawnProcess: options.spawnProcess ?? spawnSharpProbeChild
        })
    )
    this.idle = [...this.processes]
  }

  async detect(absolutePath: string, signal: AbortSignal): Promise<boolean> {
    const process = await this.acquire(signal)
    try {
      return await process.probe(absolutePath, signal)
    } finally {
      this.release(process)
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const error = new Error('Sharp animation probe pool closed')
    for (const waiter of this.waiters.splice(0)) {
      waiter.signal.removeEventListener('abort', waiter.onAbort)
      waiter.reject(error)
    }
    await Promise.all(this.processes.map((process) => process.close(error)))
  }

  private acquire(signal: AbortSignal): Promise<SharpProbeProcess> {
    if (this.closed) return Promise.reject(new Error('Sharp animation probe pool is closed'))
    if (signal.aborted) return Promise.reject(signalError(signal))
    const process = this.idle.pop()
    if (process) return Promise.resolve(process)
    return new Promise((resolve, reject) => {
      const waiter: ProbeWaiter = {
        signal,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          reject(signalError(signal))
        },
        resolve,
        reject
      }
      signal.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiters.push(waiter)
    })
  }

  private release(process: SharpProbeProcess): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      waiter.signal.removeEventListener('abort', waiter.onAbort)
      if (waiter.signal.aborted) {
        waiter.reject(signalError(waiter.signal))
        continue
      }
      waiter.resolve(process)
      return
    }
    if (!this.closed) this.idle.push(process)
  }
}

class SharpProbeProcess {
  private child: ChildProcess | undefined
  private exitPromise: Promise<void> = Promise.resolve()
  private pending: PendingProbe | undefined
  private nextId = 1
  private closed = false

  constructor(
    private readonly options: {
      timeoutSeconds: number
      hardTimeoutMs: number
      childSource: string
      spawnProcess: (source: string) => ChildProcess
    }
  ) {}

  probe(absolutePath: string, signal: AbortSignal): Promise<boolean> {
    if (this.closed) return Promise.reject(new Error('Sharp animation probe process is closed'))
    if (this.pending) return Promise.reject(new Error('Sharp animation probe process is already busy'))
    if (signal.aborted) return Promise.reject(signalError(signal))
    const child = this.ensureChild()
    const id = this.nextId++
    return new Promise<boolean>((resolve, reject) => {
      const onAbort = () => {
        if (this.pending?.id !== id) return
        this.pending.exitError = signalError(signal)
        this.killChild()
      }
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return
        const error = new Error(`Sharp animation probe exceeded ${this.options.timeoutSeconds} seconds`)
        error.name = 'SharpAnimationProbeTimeoutError'
        this.pending.exitError = error
        this.killChild()
      }, this.options.hardTimeoutMs)
      timer.unref()
      this.pending = { id, signal, onAbort, timer, resolve, reject }
      signal.addEventListener('abort', onAbort, { once: true })
      const request: ProbeRequest = {
        type: 'probe',
        id,
        absolutePath,
        timeoutSeconds: this.options.timeoutSeconds
      }
      child.send(request, (error) => {
        if (!error || this.pending?.id !== id) return
        this.pending.exitError = error
        this.killChild()
      })
    })
  }

  async close(reason: Error): Promise<void> {
    this.closed = true
    if (!this.child) return
    if (this.pending) this.pending.exitError ??= reason
    this.killChild()
    await this.exitPromise
  }

  private ensureChild(): ChildProcess {
    if (this.child) return this.child
    const child = this.options.spawnProcess(this.options.childSource)
    this.child = child
    this.exitPromise = new Promise((resolveExit) => {
      child.once('close', (code, exitSignal) => {
        if (this.child === child) this.child = undefined
        const pending = this.pending
        if (pending) {
          this.finishPending(
            pending,
            pending.exitError ??
              new Error(
                `Sharp animation probe process exited before responding (${exitSignal ?? String(code ?? 'unknown')})`
              )
          )
        }
        resolveExit()
      })
    })
    child.on('message', (message) => this.handleMessage(message))
    child.once('error', (error) => {
      if (this.pending) this.pending.exitError ??= error
    })
    return child
  }

  private handleMessage(message: unknown): void {
    if (!isProbeResponse(message) || this.pending?.id !== message.id) return
    const pending = this.pending
    if (pending.exitError) return
    if (message.ok) {
      this.finishPending(pending, undefined, (message.pages ?? 1) > 1)
      return
    }
    const error = new Error(message.message ?? 'Sharp animation probe failed') as Error & { code?: string }
    if (message.code) error.code = message.code
    this.finishPending(pending, error)
  }

  private finishPending(pending: PendingProbe, error?: Error, animated?: boolean): void {
    if (this.pending !== pending) return
    this.pending = undefined
    clearTimeout(pending.timer)
    pending.signal.removeEventListener('abort', pending.onAbort)
    if (error) pending.reject(error)
    else pending.resolve(animated ?? false)
  }

  private killChild(): void {
    const child = this.child
    if (!child) {
      if (this.pending) this.finishPending(this.pending, this.pending.exitError ?? new Error('Sharp probe stopped'))
      return
    }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
}

function spawnSharpProbeChild(source: string): ChildProcess {
  return spawn(process.execPath, ['--input-type=commonjs', '--eval', source], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
}

function isProbeResponse(message: unknown): message is ProbeResponse {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<ProbeResponse>
  return (
    candidate.type === 'result' &&
    Number.isSafeInteger(candidate.id) &&
    typeof candidate.ok === 'boolean' &&
    (candidate.pages === undefined || Number.isSafeInteger(candidate.pages)) &&
    (candidate.code === undefined || typeof candidate.code === 'string') &&
    (candidate.message === undefined || typeof candidate.message === 'string')
  )
}

function signalError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Animation scan was interrupted')
}
