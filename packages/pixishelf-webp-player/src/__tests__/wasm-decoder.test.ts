import { describe, it, expect, vi } from 'vitest'
import { WasmDecoder, type NativeModule } from '../wasm-decoder'
import { playerLimits } from '../types'
function native(overrides: Partial<NativeModule> = {}): NativeModule {
  return {
    HEAPU8: new Uint8Array(256 * 1024),
    _malloc: vi.fn(() => 1024),
    _free: vi.fn(),
    _ps_create: vi.fn(() => 1),
    _ps_append: vi.fn(() => 1),
    _ps_next: vi.fn(() => 0),
    _ps_finish: vi.fn(() => 1),
    _ps_repeat: vi.fn(() => 1),
    _ps_destroy: vi.fn(),
    _ps_pixels: () => 0,
    _ps_width: () => 2,
    _ps_height: () => 2,
    _ps_duration: () => 100,
    ...overrides
  }
}
describe('native memory boundary', () => {
  it('splits large network chunks into bounded native copies', () => {
    const module = native(),
      decoder = new WasmDecoder(module, playerLimits(true))
    decoder.append(new Uint8Array(150000))
    expect(module._ps_append).toHaveBeenCalledTimes(3)
    decoder.destroy()
    decoder.destroy()
    expect(module._ps_destroy).toHaveBeenCalledTimes(1)
    expect(module._free).toHaveBeenCalledTimes(1)
  })
  it('reports native resource exhaustion without trying to allocate frames', () => {
    const decoder = new WasmDecoder(native({ _ps_next: () => -2 }), playerLimits(true))
    expect(() => decoder.next()).toThrow('budget')
    decoder.destroy()
  })
  it('enforces the host output budget and reuses exact-sized transferable buffers', () => {
    const module = native({ _ps_next: () => 1 })
    const decoder = new WasmDecoder(module, playerLimits(true))
    const buffer = new ArrayBuffer(16)
    const result = decoder.next(buffer)
    expect(result).toMatchObject({ pixels: buffer, width: 2, height: 2, durationMs: 100 })
    decoder.destroy()
    const limited = new WasmDecoder(module, { ...playerLimits(true), maxManagedBytes: module.HEAPU8.byteLength })
    expect(() => limited.next()).toThrow('budget')
    limited.destroy()
  })
})
