import { sequentialWorker } from './sequential-worker'
import { ReplayInput } from './replay-input'
import { DecoderError } from './wasm-decoder'
import {
  FRAME_LIMIT,
  INPUT_BLOCK_LIMIT,
  INDEPENDENT_HEAP,
  MiB,
  independentHeader,
  independentFrame,
  type IndependentHeader,
  type EncodedFrame
} from './independent-frame'
import type { Frame, WorkerCommand, WorkerEvent } from './types'

const host = globalThis as unknown as {
  onmessage: (e: MessageEvent<WorkerCommand>) => void
  postMessage(e: WorkerEvent, transfer?: Transferable[]): void
}
let command: Extract<WorkerCommand, { type: 'start' }>,
  input: ReplayInput,
  header: IndependentHeader | null = null
let controller: AbortController,
  cancelled = false,
  paused = false,
  reading = false,
  fast = false,
  switching = false
let legacy: ((data: WorkerCommand) => void) | undefined
let permits = 0,
  held = 0,
  queuedBytes = 0,
  finished = false,
  drained = false
let index = 0,
  cycle = 0,
  mediaEnd = 0,
  cycleStart = 0,
  omitted = 0,
  target = 0,
  started = false,
  estimate = 0
let dispatched = 0,
  delivery = 0,
  lastSentIndex = -1,
  lastSentEnd = 0,
  epoch = 0
const queued: EncodedFrame[] = [],
  spare: ArrayBuffer[] = [],
  ready = new Map<number, Frame>()
const slots: { worker: Worker; ready: boolean; busy: boolean; task: number }[] = []
let childFailed = false
let readingInput = false
const waiters = new Set<() => void>()
const waitForChange = () => new Promise<void>((resolve) => waiters.add(resolve))
function changed() {
  for (const resolve of waiters) resolve()
  waiters.clear()
}
const send = (event: WorkerEvent, transfer?: Transferable[]) => {
  if (!cancelled) host.postMessage(event, transfer)
}
function cleanupChildren() {
  epoch++
  for (const slot of slots) slot.worker.terminate()
  slots.length = 0
  changed()
}
function fail(error: unknown) {
  if (cancelled) return
  const code = error instanceof DecoderError ? error.code : 'internal'
  send({
    type: 'error',
    error: {
      code,
      message: `WebP playback failed: ${code}`,
      recoverableByLegacy: [
        'unsupported',
        'initialization',
        'budget',
        'file-limit',
        'pixel-limit',
        'memory-limit',
        'metadata'
      ].includes(code)
    }
  })
  cancelled = true
  controller?.abort()
  void input?.reader.cancel().catch(() => {})
  cleanupChildren()
}
function availability() {
  send({
    type: 'availability',
    endMs: mediaEnd,
    omitted,
    waitingInput:
      readingInput || finished || (command.source.loop === true && input.position === header?.totalBytes && input.done)
  })
}
function flush() {
  while (ready.has(delivery)) {
    const frame = ready.get(delivery++)!
    ready.delete(delivery - 1)
    lastSentIndex = frame.index
    lastSentEnd = frame.endMs!
    send(
      { type: 'frame', frame, ...(command.diagnostics ? { sentAt: performance.timeOrigin + performance.now() } : {}) },
      [frame.pixels]
    )
  }
  if (finished && !queued.length && !ready.size && slots.every((s) => !s.busy) && !drained) {
    drained = true
    send({ type: 'drained' })
  }
}
function omitLate() {
  if (!started || !queued.length || queued[0]!.endMs > target) return
  const prediction = target + Math.min(100, estimate)
  const previous = omitted
  while (
    queued.length > 1 &&
    queued[0]!.index !== 0 &&
    queued[0]!.cycleId === queued[1]!.cycleId &&
    queued[1]!.startMs <= prediction
  ) {
    queuedBytes -= queued.shift()!.encoded.byteLength
    omitted++
  }
  if (command.diagnostics && omitted !== previous) availability()
}
function pump() {
  if (cancelled || paused || switching || legacy || !fast) return
  omitLate()
  while (permits > 0 && queued.length) {
    // Scan past obsolete compressed work when a successor is already in input.
    // Do not wait for future network data just to predict another candidate.
    if (
      queued.length === 1 &&
      queued[0]!.index !== 0 &&
      queued[0]!.endMs <= target &&
      !finished &&
      input.received > input.position
    )
      break
    const slot = slots.find((s) => s.ready && !s.busy)
    if (!slot) break
    const frame = queued.shift()!
    queuedBytes -= frame.encoded.byteLength
    const recycled = spare.pop(),
      transfer: Transferable[] = [frame.encoded]
    if (recycled) transfer.push(recycled)
    permits--
    held++
    slot.busy = true
    slot.task = dispatched++
    slot.worker.postMessage({ type: 'decode', frame, recycled }, transfer)
  }
  flush()
  void fill()
}
async function fallback(reason: string, brokenChild = false) {
  if (brokenChild) {
    childFailed = true
    changed()
  }
  if (switching || legacy || cancelled) return
  switching = true
  while (reading && !cancelled) await waitForChange()
  // A failed child invalidates undispatched results, not frames already delivered.
  if (!childFailed) {
    while (slots.some((s) => s.busy) && !cancelled && !childFailed) await waitForChange()
    if (!childFailed) flush()
  }
  if (cancelled) return
  const abandoned = slots.filter((s) => s.busy).length + ready.size
  permits += abandoned
  held -= abandoned
  cleanupChildren()
  ready.clear()
  queued.length = 0
  queuedBytes = 0
  if (cycle !== 0) {
    fail(new DecoderError('initialization'))
    return
  }
  const pixels = header ? header.width * header.height * 4 : 0
  const reserve = fast ? header!.totalBytes + pixels * 2 + FRAME_LIMIT * 4 : 0
  const limits = fast
    ? {
        ...command.limits,
        maxHeapBytes:
          Math.floor(
            Math.min(command.limits.maxHeapBytes, command.limits.maxManagedBytes - reserve - pixels * 3) / 65536
          ) * 65536,
        maxManagedBytes: command.limits.maxManagedBytes - reserve
      }
    : command.limits
  if (fast) {
    send({ type: 'pipeline', credits: 4, mode: 'sequential', reason })
    send({ type: 'availability', endMs: lastSentEnd, omitted })
  }
  legacy = sequentialWorker({ ...command, limits }, send, {
    reader: input.reader,
    chunks: input.chunks,
    receivedBytes: input.received,
    finished: input.done,
    permits,
    recycled: spare,
    paused,
    skipFrames: fast ? lastSentIndex + 1 : 0,
    timeline: fast
  })
}
async function fill() {
  if (reading || paused || cancelled || switching || legacy || finished || !fast) return
  reading = true
  let batch = 0
  try {
    while (!paused && !cancelled && !switching && queued.length < 4 && queuedBytes < 2 * MiB && batch++ < 4) {
      if (input.position === header!.totalBytes) {
        await input.eof()
        if (cancelled) return
        if (!index) throw new DecoderError('invalid')
        if (command.source.loop && (!header!.loops || cycle + 1 < header!.loops)) {
          if (held || queued.length) {
            availability()
            return
          }
          input.rewind()
          await input.take(44)
          index = 0
          cycle++
          cycleStart = mediaEnd
        } else {
          finished = true
          availability()
          flush()
          break
        }
      }
      if (header!.totalBytes - input.position < 8) throw new DecoderError('invalid')
      const chunk = await input.take(8)
      if (!chunk) throw new DecoderError('invalid')
      const size = new DataView(chunk.buffer).getUint32(4, true),
        padded = size + (size % 2)
      if (padded > header!.totalBytes - input.position) throw new DecoderError('invalid')
      if (padded > FRAME_LIMIT) {
        reading = false
        await fallback('frame-budget')
        return
      }
      const body = await input.take(padded)
      if (cancelled) return
      if (!body) throw new DecoderError('invalid')
      const frame = independentFrame(header!, chunk, body)
      if (!frame) {
        reading = false
        await fallback('dependent-frame')
        return
      }
      const startMs = mediaEnd
      mediaEnd += frame.durationMs
      queued.push({
        ...frame,
        width: header!.width,
        height: header!.height,
        index: index++,
        cycleId: cycle,
        cycleStartMs: cycleStart,
        startMs,
        endMs: mediaEnd
      })
      queuedBytes += frame.encoded.byteLength
      availability()
      pump()
    }
  } catch (error) {
    fail(error)
  } finally {
    reading = false
    changed()
    if (
      !cancelled &&
      !paused &&
      !switching &&
      !finished &&
      queued.length < 4 &&
      queuedBytes < 2 * MiB &&
      !(input.position === header!.totalBytes && held)
    )
      setTimeout(() => void fill(), 0)
  }
}
async function start() {
  controller = new AbortController()
  try {
    const response = await fetch(command.source.url, { credentials: 'same-origin', signal: controller.signal })
    if (cancelled) return
    if (response.status === 401 || response.status === 403) throw new DecoderError('auth')
    if (!response.ok) throw new DecoderError('network')
    if (!response.body) throw new DecoderError('unsupported')
    if (Number(response.headers.get('content-length')) > command.limits.maxInputBytes)
      throw new DecoderError('file-limit')
    input = new ReplayInput(
      response.body.getReader(),
      command.limits.maxInputBytes,
      (receivedBytes, inputComplete) => {
        send({ type: 'input', receivedBytes, inputComplete })
      },
      command.diagnostics ? (metric, ms) => send({ type: 'metrics', values: { [metric]: ms } }) : undefined,
      (waiting) => {
        readingInput = waiting
        if (fast && !switching) availability()
      }
    )
    if (command.sequential) {
      await fallback('diagnostic')
      return
    }
    const prefix = await input.take(44)
    if (cancelled) return
    header = prefix ? independentHeader(prefix) : null
    const pixels = header ? header.width * header.height : 0
    const reserved = header
      ? 2 * INDEPENDENT_HEAP + header.totalBytes + INPUT_BLOCK_LIMIT + FRAME_LIMIT * 6 + pixels * 4 * 5
      : Infinity
    if (
      !header ||
      header.totalBytes < 44 ||
      header.totalBytes > command.limits.maxInputBytes ||
      pixels > command.limits.maxPixels ||
      command.limits.maxHeapBytes < 2 * INDEPENDENT_HEAP ||
      reserved > command.limits.maxManagedBytes
    ) {
      await fallback('eligibility-or-budget')
      return
    }
    input.restrict(header.totalBytes, INPUT_BLOCK_LIMIT)
    fast = true
    send({ type: 'pipeline', credits: 4, mode: 'independent' })
    const generation = epoch
    for (let i = 0; i < 2; i++) {
      const worker = new Worker(new URL('./independent-worker.mjs', import.meta.url), { type: 'module' })
      const slot = { worker, ready: false, busy: false, task: 0 }
      slots.push(slot)
      worker.onerror = () => {
        if (generation === epoch) void fallback('child-initialization', true)
      }
      worker.onmessage = ({ data }) => {
        if (generation !== epoch || cancelled) return
        if (data.type === 'error') {
          void fallback('child-decode', true)
          return
        }
        if (data.type === 'ready') {
          slot.ready = true
          if (command.diagnostics) send({ type: 'decoder', variant: data.variant })
        } else if (data.type === 'frame') {
          slot.busy = false
          changed()
          estimate = estimate ? 0.8 * estimate + 0.2 * data.decodeMs : data.decodeMs
          ready.set(slot.task, data.frame)
          if (command.diagnostics) send({ type: 'metrics', values: { decode: data.decodeMs, copy: data.copyMs } })
          flush()
        }
        pump()
      }
      worker.postMessage({ type: 'init', decoderUrl: command.decoderUrl, diagnostics: command.diagnostics })
    }
    void fill()
  } catch (error) {
    fail(error)
  }
}
host.onmessage = ({ data }) => {
  if (data.type === 'destroy') {
    legacy?.(data)
    cancelled = true
    controller?.abort()
    void input?.reader.cancel().catch(() => {})
    cleanupChildren()
    return
  }
  if (cancelled) return
  if (legacy) {
    legacy(data)
    return
  }
  if (data.type === 'start') {
    command = data
    void start()
    return
  }
  if (data.type === 'pause') paused = data.paused
  if (data.type === 'target') {
    target = data.positionMs
    started = data.started
  }
  if (data.type === 'pull') {
    if (data.recycled) {
      if (!held || !data.recycled.byteLength) {
        fail(new DecoderError('internal'))
        return
      }
      held--
      spare.push(data.recycled)
    } else if (permits + held >= (fast ? 4 : 2)) {
      fail(new DecoderError('internal'))
      return
    }
    permits++
  }
  pump()
}
