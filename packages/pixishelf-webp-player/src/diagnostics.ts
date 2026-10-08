export interface TimingSummary {
  count: number
  samples: number
  totalMs: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
}

/** Cumulative totals plus a bounded reservoir, not an ever-growing frame trace. */
export class TimingSamples {
  private values: number[] = []
  private count = 0
  private total = 0
  private max = 0
  add(value: number) {
    if (!Number.isFinite(value) || value < 0) return
    this.count++
    this.total += value
    this.max = Math.max(this.max, value)
    if (this.values.length < 4096) this.values.push(value)
    else {
      const index = Math.floor(Math.random() * this.count)
      if (index < 4096) this.values[index] = value
    }
  }
  summary(): TimingSummary {
    const sorted = [...this.values].sort((a, b) => a - b)
    const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0
    return {
      count: this.count,
      samples: sorted.length,
      totalMs: this.total,
      meanMs: this.count ? this.total / this.count : 0,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: this.max
    }
  }
}
export type DiagnosticMode = 'legacy' | 'timeline' | 'no-draw'
export type WorkerMetric = 'decode' | 'copy' | 'readWait' | 'append'
export type DiagnosticMetric = WorkerMetric | 'delivery' | 'draw' | 'raf'
export interface DiagnosticsReport {
  version: 1
  runId: string
  mode: DiagnosticMode
  pipeline?: 'independent' | 'sequential'
  fallbackReason?: string
  decodeOmittedFrames?: number
  decoderVariant?: 'scalar' | 'simd'
  resourceVersion: string
  browser: string
  viewport: { width: number; height: number; dpr: number }
  width: number
  height: number
  status: string
  elapsedMs: number
  playbackWallMs: number | null
  firstFrameMs: number | null
  inputCompleteMs: number | null
  pausedMs: number
  bufferingMs: number
  decodedMediaMs: number
  decodedFrames: number
  drawnFrames: number
  skippedFrames: number
  queueExhaustions: number
  timings: Record<DiagnosticMetric, TimingSummary>
  notes: string[]
}
export class PlaybackDiagnostics {
  readonly started = performance.now()
  readonly runId =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('-')
  decoderVariant?: 'scalar' | 'simd'
  pipeline?: 'independent' | 'sequential'
  fallbackReason?: string
  decodeOmittedFrames = 0
  firstFrame: number | null = null
  inputComplete: number | null = null
  finished: number | null = null
  width = 0
  height = 0
  decodedMediaMs = 0
  decodedFrames = 0
  drawnFrames = 0
  skippedFrames = 0
  queueExhaustions = 0
  private phase = 'idle'
  private phaseAt = this.started
  private pausedMs = 0
  private bufferingMs = 0
  private lastRaf: number | null = null
  readonly timings: Record<DiagnosticMetric, TimingSamples> = {
    decode: new TimingSamples(),
    copy: new TimingSamples(),
    readWait: new TimingSamples(),
    append: new TimingSamples(),
    delivery: new TimingSamples(),
    draw: new TimingSamples(),
    raf: new TimingSamples()
  }
  constructor(
    readonly mode: DiagnosticMode,
    readonly resourceVersion: string
  ) {}
  state(status: string) {
    if (this.finished !== null) return
    const now = performance.now()
    if (this.phase === 'paused') this.pausedMs += now - this.phaseAt
    if (this.phase === 'buffering') this.bufferingMs += now - this.phaseAt
    if (status === 'buffering') this.queueExhaustions++
    if (status !== 'playing') this.lastRaf = null
    this.phase = status
    this.phaseAt = now
    if (['ended', 'error', 'destroyed'].includes(status)) this.finished ??= now
  }
  raf(now: number) {
    if (this.lastRaf !== null) this.timings.raf.add(now - this.lastRaf)
    this.lastRaf = now
  }
  report(): DiagnosticsReport {
    const now = this.finished ?? performance.now()
    return {
      version: 1,
      runId: this.runId,
      mode: this.mode,
      resourceVersion: this.resourceVersion,
      decoderVariant: this.decoderVariant,
      pipeline: this.pipeline,
      fallbackReason: this.fallbackReason,
      decodeOmittedFrames: this.decodeOmittedFrames,
      browser: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      width: this.width,
      height: this.height,
      status: this.phase,
      elapsedMs: now - this.started,
      playbackWallMs: this.firstFrame === null ? null : now - this.firstFrame,
      firstFrameMs: this.firstFrame === null ? null : this.firstFrame - this.started,
      inputCompleteMs: this.inputComplete === null ? null : this.inputComplete - this.started,
      pausedMs: this.pausedMs + (this.phase === 'paused' ? now - this.phaseAt : 0),
      bufferingMs: this.bufferingMs + (this.phase === 'buffering' ? now - this.phaseAt : 0),
      decodedMediaMs: this.decodedMediaMs,
      decodedFrames: this.decodedFrames,
      drawnFrames: this.drawnFrames,
      skippedFrames: this.skippedFrames,
      queueExhaustions: this.queueExhaustions,
      timings: Object.fromEntries(
        Object.entries(this.timings).map(([key, value]) => [key, value.summary()])
      ) as DiagnosticsReport['timings'],
      notes: [
        'draw measures the Canvas call, not screen presentation',
        'delivery includes message scheduling; it is not pure transfer time',
        'readWait measures stream read waiting, not exclusively network time',
        'repeat runs do not imply a cache hit',
        'elapsedMs includes initialization; playbackWallMs includes pauses and buffering'
      ]
    }
  }
}
