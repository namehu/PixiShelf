import { FrameClock } from './clock'
import {
  playerLimits,
  type Frame,
  type PlayerEvent,
  type PlayerFailure,
  type PlayerLimits,
  type PlayerSnapshot,
  type PlayerStatus,
  type WebpSource,
  type WorkerCommand,
  type WorkerEvent
} from './types'

export interface PlayerOptions {
  workerUrl: string
  decoderUrl: string
  limits?: PlayerLimits
}
export class WebpPlayer {
  private worker: Worker | null = null
  private source: WebpSource | null = null
  private listeners = new Set<(event: PlayerEvent) => void>()
  private queue: Frame[] = []
  private clock = new FrameClock()
  private snapshot: PlayerSnapshot = {
    status: 'idle',
    frameIndex: null,
    presentedMs: 0,
    positionMs: 0,
    cycleIndex: 0,
    durationMs: null,
    bufferedFrames: 0,
    receivedBytes: 0,
    inputComplete: false
  }
  private generation = 0
  private desired = false
  private drained = false
  private painted = false
  private currentDuration: number | null = null
  private cyclePresentedMs = 0
  private lastProgressEmission = -Infinity
  private raf = 0
  private resolveLoad: (() => void) | null = null
  private rejectLoad: ((error: Error) => void) | null = null
  private limits: PlayerLimits
  constructor(
    private canvas: HTMLCanvasElement,
    private options: PlayerOptions
  ) {
    this.limits = options.limits ?? playerLimits(window.innerWidth < 768)
  }
  subscribe(listener: (event: PlayerEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot(): PlayerSnapshot {
    const partial = this.currentDuration === null ? 0 : this.currentDuration - this.clock.peekRemaining(performance.now())
    return {
      ...this.snapshot,
      positionMs: Math.max(0, this.cyclePresentedMs + partial),
      bufferedFrames: this.queue.length
    }
  }
  private emit(event: PlayerEvent) {
    for (const listener of this.listeners) listener(event)
  }
  private state(status: PlayerStatus) {
    if (this.snapshot.status === status) return
    this.snapshot.status = status
    this.emit({ type: 'state', snapshot: this.getSnapshot() })
  }
  private progress(now: number, force = false) {
    if (!force && now - this.lastProgressEmission < 100) return
    this.lastProgressEmission = now
    this.emit({ type: 'progress', snapshot: this.getSnapshot() })
  }
  private command(command: WorkerCommand, transfer?: Transferable[]) {
    this.worker?.postMessage(command, transfer ?? [])
  }
  private release() {
    ++this.generation
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.worker?.terminate()
    this.worker = null
    this.queue = []
    this.clock.reset()
    this.currentDuration = null
    this.cyclePresentedMs = 0
    this.lastProgressEmission = -Infinity
    this.rejectLoad?.(new DOMException('Playback cancelled', 'AbortError'))
    this.resolveLoad = null
    this.rejectLoad = null
  }
  load(source: WebpSource): Promise<void> {
    if (this.snapshot.status === 'destroyed') return Promise.reject(new Error('Player destroyed'))
    this.release()
    this.source = source
    this.desired = false
    this.drained = false
    this.painted = false
    this.canvas.width = 0
    this.canvas.height = 0
    this.snapshot = {
      status: 'idle',
      frameIndex: null,
      presentedMs: 0,
      positionMs: 0,
      cycleIndex: 0,
      durationMs: Number.isSafeInteger(source.durationMs) && source.durationMs! > 0 ? source.durationMs! : null,
      bufferedFrames: 0,
      receivedBytes: 0,
      inputComplete: false
    }
    this.state('loading')
    const promise = new Promise<void>((resolve, reject) => {
      this.resolveLoad = resolve
      this.rejectLoad = reject
    })
    const generation = this.generation
    let stage: 'capability' | 'initialization' = 'capability'
    try {
      const url = new URL(source.url, window.location.href)
      if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol))
        throw new Error('unsupported')
      for (const asset of [this.options.workerUrl, this.options.decoderUrl]) {
        if (new URL(asset, window.location.href).origin !== window.location.origin) throw new Error('unsupported')
      }
      if (!globalThis.WebAssembly || !globalThis.Worker || !globalThis.ReadableStream) throw new Error('unsupported')
      if (source.size && source.size > this.limits.maxInputBytes) throw new Error('file-limit')
      stage = 'initialization'
      this.worker = new Worker(this.options.workerUrl, { type: 'module', name: 'pixishelf-webp' })
      this.worker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
        if (generation !== this.generation) return
        this.receive(data)
      }
      this.worker.onerror = () => {
        if (generation === this.generation)
          this.fail({ code: 'initialization', message: 'WebP worker unavailable', recoverableByLegacy: !this.painted })
      }
      this.command({
        type: 'start',
        source: { ...source, url: url.href },
        decoderUrl: new URL(this.options.decoderUrl, location.href).href,
        limits: this.limits
      })
      this.command({ type: 'pull' })
      this.command({ type: 'pull' })
    } catch (error) {
      const code =
        error instanceof Error && error.message === 'file-limit'
          ? 'file-limit'
          : stage === 'initialization'
            ? 'initialization'
            : 'unsupported'
      this.fail({ code, message: code, recoverableByLegacy: true })
    }
    return promise
  }
  private receive(event: WorkerEvent) {
    if (event.type === 'error') {
      this.fail(event.error)
      return
    }
    if (event.type === 'input') {
      this.snapshot.receivedBytes = event.receivedBytes
      this.snapshot.inputComplete = event.inputComplete
      return
    }
    if (event.type === 'drained') this.drained = true
    if (event.type === 'frame') {
      if (this.queue.length >= 2) {
        this.fail({ code: 'internal', message: 'Frame queue overflow', recoverableByLegacy: false })
        return
      }
      this.queue.push(event.frame)
      this.resolveLoad?.()
      this.resolveLoad = null
      this.rejectLoad = null
      if (!this.desired && this.snapshot.status !== 'paused') this.state('ready')
    }
    this.schedule()
  }
  private fail(error: PlayerFailure) {
    if (this.snapshot.status === 'error' || this.snapshot.status === 'destroyed') return
    this.desired = false
    this.rejectLoad?.(new Error(error.message))
    this.rejectLoad = null
    this.resolveLoad = null
    this.release()
    this.state('error')
    this.emit({ type: 'error', error: { ...error, recoverableByLegacy: error.recoverableByLegacy && !this.painted } })
  }
  play() {
    if (['destroyed', 'error', 'ended', 'idle'].includes(this.snapshot.status)) return
    if (this.desired) return
    this.desired = true
    this.clock.resume(performance.now())
    this.command({ type: 'pause', paused: false })
    this.schedule()
  }
  pause() {
    if (['destroyed', 'error', 'ended', 'idle'].includes(this.snapshot.status)) return
    this.desired = false
    this.clock.pause(performance.now())
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.command({ type: 'pause', paused: true })
    this.state('paused')
    this.progress(performance.now(), true)
  }
  private schedule() {
    if (!this.desired || this.raf || ['destroyed', 'error', 'ended'].includes(this.snapshot.status)) return
    const generation = this.generation
    this.raf = requestAnimationFrame((now) => {
      this.raf = 0
      if (generation !== this.generation || !this.desired) return
      try {
        this.tick(now)
      } catch {
        this.fail({ code: 'internal', message: 'Canvas playback failed', recoverableByLegacy: false })
      }
    })
  }
  private tick(now: number) {
    const generation = this.generation
    const hadCurrentFrame = this.currentDuration !== null
    if (this.currentDuration !== null && this.clock.advance(now) > 0) {
      this.state('playing')
      this.progress(now)
      this.schedule()
      return
    }
    if (this.currentDuration !== null) {
      this.snapshot.presentedMs += this.currentDuration
      this.cyclePresentedMs += this.currentDuration
      this.currentDuration = null
    }
    const frame = this.queue.shift()
    if (!frame) {
      if (this.drained) {
        this.desired = false
        this.worker?.terminate()
        this.worker = null
        this.state('ended')
        this.progress(now, true)
        if (generation === this.generation) this.emit({ type: 'ended' })
      } else {
        this.state(this.painted ? 'buffering' : 'loading')
        this.progress(now, true)
      }
      return
    }
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width
      this.canvas.height = frame.height
    }
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0)
    if (frame.cycleId !== this.snapshot.cycleIndex) {
      this.snapshot.cycleIndex = frame.cycleId
      this.cyclePresentedMs = 0
    }
    this.snapshot.frameIndex = frame.index
    this.currentDuration = frame.durationMs
    // Preserve cadence across normal RAF quantization, but never skip a frame
    // or carry network buffering time into the next frame's duration.
    const correction = hadCurrentFrame ? Math.min(this.clock.overdueMs, frame.durationMs - 1) : 0
    this.clock.start(frame.durationMs - correction, now)
    if (!this.painted) {
      this.painted = true
      this.emit({ type: 'first-frame' })
    }
    if (generation !== this.generation) return
    this.state('playing')
    this.progress(now)
    this.command({ type: 'pull', recycled: frame.pixels }, [frame.pixels])
    this.schedule()
  }
  restart() {
    if (!this.source) return Promise.reject(new Error('No source'))
    const promise = this.load(this.source)
    this.play()
    return promise
  }
  destroy() {
    if (this.snapshot.status === 'destroyed') return
    this.desired = false
    this.release()
    this.source = null
    this.canvas.width = 0
    this.canvas.height = 0
    this.state('destroyed')
    this.listeners.clear()
  }
}
