import { loadNative } from './load-native'
import { DecoderError, WasmDecoder } from './wasm-decoder'
import type { WorkerCommand, WorkerEvent, PlayerFailure } from './types'

export interface SequentialSeed {
  reader: ReadableStreamDefaultReader<Uint8Array>
  chunks: Uint8Array[]
  receivedBytes: number
  finished: boolean
  permits: number
  recycled: ArrayBuffer[]
  paused: boolean
  skipFrames: number
  timeline: boolean
}
export function sequentialWorker(
  command: Extract<WorkerCommand, { type: 'start' }>,
  post: (event: WorkerEvent, transfer?: Transferable[]) => void,
  seed?: SequentialSeed
) {
  let decoder: WasmDecoder | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let controller: AbortController | undefined
  let paused = false,
    cancelled = false,
    pumping = false,
    finished = false,
    drained = false
  let receivedBytes = 0,
    frameIndex = 0,
    cycleId = 0,
    permits = 0
  let loop = false
  let diagnostics = false
  const recycled: ArrayBuffer[] = seed?.recycled ?? []
  let mediaMs = 0,
    cycleStartMs = 0
  let discard = seed?.skipFrames ?? 0
  let replayBatch = 0
  const creditLimit = seed?.timeline ? 4 : 2
  if (seed) {
    permits = seed.permits
    paused = seed.paused
    receivedBytes = seed.receivedBytes
  }
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined
  const send = (event: WorkerEvent, transfer?: Transferable[]) => {
    if (!cancelled) post(event, transfer)
  }

  function cleanup() {
    controller?.abort()
    void reader?.cancel().catch(() => {})
    decoder?.destroy()
    decoder = undefined
    pendingRead = undefined
    recycled.length = 0
  }
  function fail(error: unknown, fallback: PlayerFailure['code'] = 'internal') {
    if (cancelled) return
    const code = error instanceof DecoderError ? error.code : fallback
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
    cleanup()
  }
  // Bound partial-demux rebuild frequency without waiting for the full file.
  // Keep a timed-out read so it cannot race a second read or lose a chunk.
  async function appendInput() {
    let bytes = 0
    const deadline = performance.now() + 50
    while (!paused && !cancelled) {
      pendingRead ??= reader!.read()
      let item: ReadableStreamReadResult<Uint8Array> | null
      let timer: ReturnType<typeof setTimeout> | undefined
      const readStarted = diagnostics ? performance.now() : 0
      try {
        item =
          bytes === 0
            ? await pendingRead
            : await Promise.race([
                pendingRead,
                new Promise<null>((resolve) => {
                  timer = setTimeout(() => resolve(null), Math.max(0, deadline - performance.now()))
                })
              ])
      } catch {
        throw new DecoderError('network')
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        if (diagnostics) send({ type: 'metrics', values: { readWait: performance.now() - readStarted } })
      }
      if (item === null || cancelled) return
      pendingRead = undefined
      const appendStarted = diagnostics ? performance.now() : 0
      if (item.done) {
        decoder!.finish()
        finished = true
      } else {
        decoder!.append(item.value)
        receivedBytes += item.value.byteLength
        bytes += item.value.byteLength
      }
      if (diagnostics) send({ type: 'metrics', values: { append: performance.now() - appendStarted } })
      send({ type: 'input', receivedBytes, inputComplete: finished })
      if (finished || bytes >= 256 * 1024 || performance.now() >= deadline) return
    }
  }
  async function pump() {
    if (pumping || paused || cancelled || drained || !decoder || !reader) return
    pumping = true
    try {
      while (permits > 0 && !paused && !cancelled) {
        const spare = recycled.pop()
        const frame = decoder.next(spare)
        if (frame === 2) {
          if (spare) recycled.push(spare)
          if (loop && decoder.repeat()) {
            frameIndex = 0
            cycleId++
            cycleStartMs = mediaMs
            continue
          }
          drained = true
          send({ type: 'drained' })
          return
        }
        if (frame !== 0) {
          const startMs = mediaMs
          mediaMs += frame.durationMs
          const index = frameIndex++
          if (discard > 0) {
            discard--
            recycled.push(frame.pixels)
            if (++replayBatch % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
            continue
          }
          if (seed?.timeline) send({ type: 'availability', endMs: mediaMs, omitted: 0 })
          permits--
          send(
            {
              type: 'frame',
              frame: { ...frame, index, cycleId, ...(seed?.timeline ? { startMs, endMs: mediaMs, cycleStartMs } : {}) },
              ...(diagnostics ? { sentAt: performance.timeOrigin + performance.now() } : {})
            },
            [frame.pixels]
          )
          continue
        }
        if (spare) recycled.push(spare)
        if (finished) throw new DecoderError('invalid')
        await appendInput()
      }
    } catch (error) {
      fail(error)
    } finally {
      pumping = false
    }
  }
  async function start(command: Extract<WorkerCommand, { type: 'start' }>) {
    loop = command.source.loop === true
    diagnostics = command.diagnostics === true
    try {
      const { module, variant } = await loadNative(command.decoderUrl, command.limits.maxHeapBytes)
      if (cancelled) return
      if (diagnostics) send({ type: 'decoder', variant })
      decoder = new WasmDecoder(
        module,
        command.limits,
        diagnostics ? (metric, elapsed) => send({ type: 'metrics', values: { [metric]: elapsed } }) : undefined
      )
    } catch (error) {
      fail(error, 'initialization')
      return
    }
    if (seed) {
      reader = seed.reader
      try {
        for (let i = 0; i < seed.chunks.length; i++) {
          if (cancelled) return
          decoder!.append(seed.chunks[i]!)
          // Drop the compressed replay copy as the native decoder takes ownership.
          seed.chunks[i] = new Uint8Array()
        }
        seed.chunks.length = 0
        if (seed.finished) {
          decoder!.finish()
          finished = true
        }
        void pump()
      } catch (error) {
        fail(error)
      }
      return
    }
    controller = new AbortController()
    try {
      const response = await fetch(command.source.url, { credentials: 'same-origin', signal: controller.signal })
      if (cancelled) return
      if (response.status === 401 || response.status === 403) throw new DecoderError('auth')
      if (!response.ok) throw new DecoderError('network')
      if (!response.body) throw new DecoderError('unsupported')
      const length = Number(response.headers.get('content-length'))
      if (length > command.limits.maxInputBytes) throw new DecoderError('file-limit')
      reader = response.body.getReader()
      void pump()
    } catch (error) {
      fail(error, 'network')
    }
  }
  const receive = (data: WorkerCommand) => {
    if (data.type === 'destroy') {
      cancelled = true
      cleanup()
      return
    }
    if (cancelled) return
    if (data.type === 'start') {
      void start(data)
      return
    }
    if (data.type === 'pause') paused = data.paused
    if (data.type === 'pull') {
      if (permits >= creditLimit) {
        fail(new DecoderError('internal'))
        return
      }
      permits++
      if (data.recycled) recycled.push(data.recycled)
    }
    void pump()
  }

  void start(command)
  return receive
}
