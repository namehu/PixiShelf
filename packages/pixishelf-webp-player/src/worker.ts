import { DecoderError, WasmDecoder, type NativeModule } from './wasm-decoder'
import type { WorkerCommand, WorkerEvent, PlayerFailure } from './types'

const host = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerCommand>) => void
  postMessage(event: WorkerEvent, transfer?: Transferable[]): void
}
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
  permits = 0
let loop = false
const recycled: ArrayBuffer[] = []
let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined
const send = (event: WorkerEvent, transfer?: Transferable[]) => {
  if (!cancelled) host.postMessage(event, transfer)
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
    }
    if (item === null || cancelled) return
    pendingRead = undefined
    if (item.done) {
      decoder!.finish()
      finished = true
    } else {
      decoder!.append(item.value)
      receivedBytes += item.value.byteLength
      bytes += item.value.byteLength
    }
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
          continue
        }
        drained = true
        send({ type: 'drained' })
        return
      }
      if (frame !== 0) {
        permits--
        send({ type: 'frame', frame: { ...frame, index: frameIndex++ } }, [frame.pixels])
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
  try {
    const { default: factory } = await import(/* @vite-ignore */ command.decoderUrl)
    if (cancelled) return
    const memory = new WebAssembly.Memory({ initial: 256, maximum: command.limits.maxHeapBytes / 65536 })
    const module: NativeModule = await factory({
      wasmMemory: memory,
      locateFile: (file: string) => new URL(file, command.decoderUrl).href
    })
    if (cancelled) return
    decoder = new WasmDecoder(module, command.limits)
  } catch (error) {
    fail(error, 'initialization')
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
host.onmessage = ({ data }) => {
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
    if (permits >= 2) {
      fail(new DecoderError('internal'))
      return
    }
    permits++
    if (data.recycled) recycled.push(data.recycled)
  }
  void pump()
}
