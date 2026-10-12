import { DecoderError } from './wasm-decoder'
import type { PlayerLimits } from './types'

/** Demand-driven: highWaterMark zero prevents read-ahead while paused. */
export function openPortInput(
  port: MessagePort
): Promise<{ reader: ReadableStreamDefaultReader<Uint8Array>; limits: PlayerLimits; cached: boolean }> {
  return new Promise((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    let pending: (() => void) | undefined
    let done = false
    port.onmessage = ({ data }) => {
      if (done) return
      if (data.type === 'error') {
        done = true
        const error = new DecoderError(data.code)
        reject(error)
        controller?.error(error)
        pending?.()
        port.close()
      } else if (data.type === 'opened') {
        const stream = new ReadableStream<Uint8Array>(
          {
            start(c) {
              controller = c
            },
            pull() {
              return new Promise<void>((r) => {
                pending = r
                port.postMessage({ type: 'read' })
              })
            },
            cancel() {
              done = true
              port.postMessage({ type: 'cancel' })
              pending?.()
              port.close()
            }
          },
          { highWaterMark: 0 }
        )
        resolve({ reader: stream.getReader(), limits: data.limits, cached: data.cached === true })
      } else if (data.type === 'chunk') {
        if (data.done) {
          done = true
          controller!.close()
          port.close()
        } else controller!.enqueue(new Uint8Array(data.bytes))
        const finish = pending
        pending = undefined
        finish?.()
      }
    }
    port.postMessage({ type: 'open' })
  })
}
