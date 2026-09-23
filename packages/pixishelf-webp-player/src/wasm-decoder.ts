import type { PlayerLimits, PlayerErrorCode } from './types'
export interface NativeModule {
  HEAPU8: Uint8Array
  _malloc(n: number): number
  _free(ptr: number): void
  _ps_create(bytes: number, pixels: number): number
  _ps_append(handle: number, bytes: number, length: number): number
  _ps_next(handle: number): number
  _ps_finish(handle: number): number
  _ps_repeat(handle: number): number
  _ps_pixels(handle: number): number
  _ps_width(handle: number): number
  _ps_height(handle: number): number
  _ps_duration(handle: number): number
  _ps_destroy(handle: number): void
}
export class DecoderError extends Error {
  constructor(public code: PlayerErrorCode) {
    super(code)
  }
}
function check(result: number) {
  if (result < 0) throw new DecoderError(result === -2 ? 'budget' : result === -3 ? 'metadata' : 'invalid')
  return result
}
export class WasmDecoder {
  private handle: number
  private scratch: number
  private readonly scratchSize = 64 * 1024
  constructor(
    private module: NativeModule,
    private limits: PlayerLimits
  ) {
    this.handle = module._ps_create(limits.maxInputBytes, limits.maxPixels)
    this.scratch = module._malloc(this.scratchSize)
    if (!this.handle || !this.scratch) {
      this.destroy()
      throw new DecoderError('budget')
    }
  }
  append(bytes: Uint8Array) {
    for (let offset = 0; offset < bytes.length; offset += this.scratchSize) {
      const part = bytes.subarray(offset, offset + this.scratchSize)
      this.module.HEAPU8.set(part, this.scratch)
      check(this.module._ps_append(this.handle, this.scratch, part.length))
    }
  }
  next(recycled?: ArrayBuffer) {
    const result = check(this.module._ps_next(this.handle))
    if (result === 0 || result === 2) return result
    const width = this.module._ps_width(this.handle),
      height = this.module._ps_height(this.handle)
    const bytes = width * height * 4
    // Two transferable frames plus the visible canvas; heap includes native input/canvases/scratch.
    if (this.module.HEAPU8.byteLength + bytes * 3 > this.limits.maxManagedBytes) throw new DecoderError('budget')
    const pixels = recycled?.byteLength === bytes ? recycled : new ArrayBuffer(bytes)
    const offset = this.module._ps_pixels(this.handle)
    new Uint8Array(pixels).set(this.module.HEAPU8.subarray(offset, offset + bytes))
    return { pixels, width, height, durationMs: this.module._ps_duration(this.handle) }
  }
  finish() {
    check(this.module._ps_finish(this.handle))
  }
  repeat() {
    return check(this.module._ps_repeat(this.handle)) === 1
  }
  destroy() {
    if (this.handle) this.module._ps_destroy(this.handle)
    if (this.scratch) this.module._free(this.scratch)
    this.handle = 0
    this.scratch = 0
  }
}
