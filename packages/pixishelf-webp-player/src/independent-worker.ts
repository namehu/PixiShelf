import { loadNative } from './load-native'
import { DecoderError, type NativeModule } from './wasm-decoder'
import type { EncodedFrame } from './independent-frame'
import { INDEPENDENT_HEAP } from './independent-frame'
interface StillModule extends NativeModule {
  _WebPGetInfo(input: number, length: number, width: number, height: number): number
  _WebPDecodeRGBAInto(input: number, length: number, output: number, size: number, stride: number): number
}
let module: StillModule,
  input = 0,
  capacity = 0,
  output = 0,
  outputSize = 0,
  dimensions = 0,
  diagnostics = false
const host = globalThis as unknown as {
  onmessage: (e: MessageEvent) => void
  postMessage(e: unknown, transfer?: Transferable[]): void
}
host.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const loaded = await loadNative(data.decoderUrl, INDEPENDENT_HEAP)
      module = loaded.module as StillModule
      if (!module._WebPGetInfo || !module._WebPDecodeRGBAInto) throw new DecoderError('initialization')
      dimensions = module._malloc(8)
      if (!dimensions) throw new DecoderError('memory-limit')
      diagnostics = data.diagnostics === true
      host.postMessage({ type: 'ready', variant: loaded.variant })
      return
    }
    if (data.type !== 'decode' || !module) return
    const frame: EncodedFrame = data.frame
    const bytes = new Uint8Array(frame.encoded),
      size = frame.width * frame.height * 4
    if (bytes.length > capacity) {
      if (input) module._free(input)
      input = module._malloc(bytes.length)
      capacity = bytes.length
      if (!input) throw new DecoderError('memory-limit')
    }
    module.HEAPU8.set(bytes, input)
    if (!module._WebPGetInfo(input, bytes.length, dimensions, dimensions + 4)) throw new DecoderError('invalid')
    const view = new DataView(module.HEAPU8.buffer)
    if (view.getInt32(dimensions, true) !== frame.width || view.getInt32(dimensions + 4, true) !== frame.height)
      throw new DecoderError('invalid')
    if (outputSize !== size) {
      if (output) module._free(output)
      output = module._malloc(size)
      outputSize = size
      if (!output) throw new DecoderError('memory-limit')
    }
    const begun = performance.now()
    if (!module._WebPDecodeRGBAInto(input, bytes.length, output, size, frame.width * 4))
      throw new DecoderError('invalid')
    const decodeMs = performance.now() - begun
    const copyAt = diagnostics ? performance.now() : 0
    const pixels = data.recycled?.byteLength === size ? data.recycled : new ArrayBuffer(size)
    new Uint8Array(pixels).set(module.HEAPU8.subarray(output, output + size))
    const { encoded: _encoded, ...meta } = frame
    host.postMessage(
      {
        type: 'frame',
        frame: { ...meta, pixels },
        decodeMs,
        ...(diagnostics ? { copyMs: performance.now() - copyAt } : {})
      },
      [pixels]
    )
  } catch (error) {
    host.postMessage({ type: 'error', code: error instanceof DecoderError ? error.code : 'initialization' })
  }
}
