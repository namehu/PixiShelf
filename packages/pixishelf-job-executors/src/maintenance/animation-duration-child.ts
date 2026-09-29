import { spawn, type ChildProcess } from 'node:child_process'
import {
  ANIMATION_DURATION_CACHE_BYTES,
  ANIMATION_DURATION_CHUNK_LIMIT,
  ANIMATION_DURATION_READ_LIMIT,
  parseWebpAnimationDuration,
  type WebpDurationResult
} from './animation-duration-webp.ts'

export const ANIMATION_DURATION_FILE_TIMEOUT_MS = 60_000
const CHILD_EXIT_GRACE_MS = 500

export interface ProbeFileState {
  size: bigint
  mtimeMs: bigint
  ctimeMs: bigint | null
  deviceId: bigint | null
  inode: bigint | null
}

export interface IsolatedDurationResult {
  probe: WebpDurationResult
  preState: ProbeFileState
  postState: ProbeFileState
  elapsedMs: number
}

interface WireState {
  size: string
  mtimeMs: string
  ctimeMs: string
  deviceId: string
  inode: string
}

interface WireResponse {
  type: 'result'
  id: number
  ok: boolean
  probe?: WebpDurationResult
  preState?: WireState
  postState?: WireState
  elapsedMs?: number
  code?: string
  message?: string
}

const CHILD_SOURCE = String.raw`
'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const ANIMATION_DURATION_CACHE_BYTES = ${ANIMATION_DURATION_CACHE_BYTES}
const ANIMATION_DURATION_CHUNK_LIMIT = ${ANIMATION_DURATION_CHUNK_LIMIT}
const ANIMATION_DURATION_READ_LIMIT = ${ANIMATION_DURATION_READ_LIMIT}
const parseWebpAnimationDuration = ${parseWebpAnimationDuration.toString()}
const state = (s) => ({
  size: String(s.size), mtimeMs: String(s.mtimeMs), ctimeMs: String(s.ctimeMs),
  deviceId: String(s.dev), inode: String(s.ino)
})
const equalState = (a, b) =>
  a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs &&
  a.dev === b.dev && a.ino === b.ino
process.on('disconnect', () => process.exit(0))
process.on('message', async (request) => {
  if (!request || request.type !== 'probe' || !Number.isSafeInteger(request.id)) return
  const started = performance.now()
  let handle
  let pre
  let absolutePath
  let response
  try {
    const root = await fs.realpath(request.scanRoot)
    const candidate = path.resolve(root, request.relativePath.replace(/^[/\\]+/, ''))
    const inside = (value) => {
      const relative = path.relative(root, value)
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    }
    if (!inside(candidate)) {
      const error = new Error('Media path is outside the configured scan root')
      error.code = 'PATH_OUTSIDE_SCAN_ROOT'
      throw error
    }
    absolutePath = await fs.realpath(candidate)
    if (!inside(absolutePath)) {
      const error = new Error('Media symlink escapes the configured scan root')
      error.code = 'PATH_OUTSIDE_SCAN_ROOT'
      throw error
    }
    const prePath = await fs.stat(absolutePath, { bigint: true })
    handle = await fs.open(absolutePath, 'r')
    pre = await handle.stat({ bigint: true })
    if (!pre.isFile() || !equalState(prePath, pre)) {
      const error = new Error('Source changed before duration probe')
      error.code = 'SOURCE_CHANGED'
      throw error
    }
    const probe = await parseWebpAnimationDuration({
      size: Number(pre.size),
      read: async (position, length) => {
        const buffer = Buffer.allocUnsafe(length)
        const read = await handle.read(buffer, 0, length, position)
        return buffer.subarray(0, read.bytesRead)
      }
    })
    const post = await handle.stat({ bigint: true })
    const postPath = await fs.stat(absolutePath, { bigint: true })
    if (!equalState(pre, post) || !equalState(post, postPath)) {
      const error = new Error('Source changed during duration probe')
      error.code = 'SOURCE_CHANGED'
      throw error
    }
    response = {
      type: 'result', id: request.id, ok: true, probe,
      preState: state(pre), postState: state(post), elapsedMs: performance.now() - started
    }
  } catch (error) {
    let failureStates = {}
    if (handle && pre && absolutePath) {
      try {
        const post = await handle.stat({ bigint: true })
        const postPath = await fs.stat(absolutePath, { bigint: true })
        if (equalState(post, postPath)) failureStates = { preState: state(pre), postState: state(post) }
      } catch {}
    }
    response = {
      type: 'result', id: request.id, ok: false,
      code: typeof error.code === 'string' ? error.code : 'PROBE_IO_ERROR',
      message: error instanceof Error ? error.message : 'Duration probe failed',
      ...failureStates
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
  if (process.connected) process.send(response, () => undefined)
})
`

interface Pending {
  id: number
  timer: NodeJS.Timeout
  signal: AbortSignal
  onAbort: () => void
  resolve: (result: IsolatedDurationResult) => void
  reject: (error: Error) => void
  terminalError?: Error
}

export interface IsolatedDurationProbeOptions {
  timeoutMs?: number
  spawnProcess?: (source: string) => ChildProcess
}

/** A single reusable child; a child that ignores SIGKILL poisons this instance. */
export class IsolatedDurationProbe {
  private child: ChildProcess | null = null
  private pending: Pending | null = null
  private nextId = 1
  private poisoned = false
  private closed = false
  private exitPromise: Promise<void> = Promise.resolve()

  constructor(private readonly options: IsolatedDurationProbeOptions = {}) {}

  async probe(scanRoot: string, relativePath: string, signal: AbortSignal): Promise<IsolatedDurationResult> {
    if (this.closed || this.poisoned) throw codedError('PROBE_CHILD_UNAVAILABLE', 'Duration probe child is unavailable')
    if (this.pending) throw codedError('PROBE_CHILD_BUSY', 'Duration probe child is busy')
    if (signal.aborted) throw signalError(signal)
    const child = this.ensureChild()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const failAndKill = (error: Error) => {
        if (this.pending?.id !== id) return
        this.pending.terminalError ??= error
        this.poisoned = true
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        const grace = setTimeout(() => {
          if (this.pending?.id === id) this.finish(this.pending, this.pending.terminalError)
        }, CHILD_EXIT_GRACE_MS)
        grace.unref()
      }
      const onAbort = () => failAndKill(signalError(signal))
      const timer = setTimeout(
        () => failAndKill(codedError('PROBE_TIMEOUT', 'Duration probe exceeded its file deadline')),
        this.options.timeoutMs ?? ANIMATION_DURATION_FILE_TIMEOUT_MS
      )
      timer.unref()
      this.pending = { id, signal, onAbort, timer, resolve, reject }
      signal.addEventListener('abort', onAbort, { once: true })
      child.send({ type: 'probe', id, scanRoot, relativePath }, (error) => {
        if (error) failAndKill(codedError('PROBE_IPC_ERROR', error.message))
      })
    })
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL')
    if (this.pending) this.finish(this.pending, codedError('PROBE_CANCELLED', 'Duration probe closed'))
    await Promise.race([this.exitPromise, new Promise<void>((resolve) => setTimeout(resolve, CHILD_EXIT_GRACE_MS))])
  }

  private ensureChild(): ChildProcess {
    if (this.child) return this.child
    const child = (this.options.spawnProcess ?? spawnChild)(CHILD_SOURCE)
    this.child = child
    this.exitPromise = new Promise((resolve) => {
      child.once('close', (code, exitSignal) => {
        if (this.child === child) this.child = null
        const pending = this.pending
        if (pending) this.finish(pending, pending.terminalError ?? codedError('PROBE_CHILD_EXIT', `Duration probe child exited (${exitSignal ?? code})`))
        this.poisoned = false
        resolve()
      })
    })
    child.on('message', (message: unknown) => this.onMessage(message))
    child.once('error', (error) => {
      if (this.pending) this.finish(this.pending, codedError('PROBE_CHILD_EXIT', error.message))
    })
    return child
  }

  private onMessage(message: unknown): void {
    if (!isWireResponse(message) || !this.pending || message.id !== this.pending.id) return
    const pending = this.pending
    if (pending.terminalError) return
    if (!message.ok) {
      const error = codedError(message.code ?? 'PROBE_IO_ERROR', message.message ?? 'Duration probe failed') as Error & {
        preState?: ProbeFileState
        postState?: ProbeFileState
      }
      if (message.preState && message.postState) {
        error.preState = parseState(message.preState)
        error.postState = parseState(message.postState)
      }
      this.finish(pending, error)
      return
    }
    if (!message.probe || !message.preState || !message.postState || typeof message.elapsedMs !== 'number') {
      this.finish(pending, codedError('PROBE_IPC_ERROR', 'Duration probe returned incomplete data'))
      return
    }
    this.finish(pending, undefined, {
      probe: message.probe,
      preState: parseState(message.preState),
      postState: parseState(message.postState),
      elapsedMs: message.elapsedMs
    })
  }

  private finish(pending: Pending, error?: Error, result?: IsolatedDurationResult): void {
    if (this.pending !== pending) return
    this.pending = null
    clearTimeout(pending.timer)
    pending.signal.removeEventListener('abort', pending.onAbort)
    if (error) pending.reject(error)
    else pending.resolve(result!)
  }
}

function spawnChild(source: string): ChildProcess {
  return spawn(process.execPath, ['--input-type=commonjs', '--eval', source], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
}

function parseState(state: WireState): ProbeFileState {
  return {
    size: BigInt(state.size), mtimeMs: BigInt(state.mtimeMs), ctimeMs: BigInt(state.ctimeMs),
    deviceId: BigInt(state.deviceId), inode: BigInt(state.inode)
  }
}

function isWireResponse(value: unknown): value is WireResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WireResponse>
  return candidate.type === 'result' && Number.isSafeInteger(candidate.id) && typeof candidate.ok === 'boolean'
}

function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function signalError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : codedError('PROBE_CANCELLED', 'Duration probe was interrupted')
}
