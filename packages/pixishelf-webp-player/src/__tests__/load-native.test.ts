import { afterEach, expect, it, vi } from 'vitest'
import { supportsSimd } from '../load-native'
afterEach(() => vi.restoreAllMocks())
it('validates the SIMD probe on a SIMD-capable runtime', () => {
  expect(supportsSimd()).toBe(true)
})
it('handles unsupported or unavailable validation', () => {
  vi.spyOn(WebAssembly, 'validate').mockReturnValue(false)
  expect(supportsSimd()).toBe(false)
  vi.mocked(WebAssembly.validate).mockImplementation(() => {
    throw new Error('unsupported')
  })
  expect(supportsSimd()).toBe(false)
})
