import { describe, expect, it } from 'vitest'
import { canPreloadAdaptedImage } from '../media-preload'

const candidate = { size: 1024 * 1024, width: 2000, height: 1000 }

describe('canPreloadAdaptedImage', () => {
  it('uses stricter mobile byte and pixel budgets', () => {
    expect(canPreloadAdaptedImage(candidate, { isMobile: true, saveData: false })).toBe(true)
    expect(canPreloadAdaptedImage({ ...candidate, size: 7 * 1024 * 1024 }, { isMobile: true, saveData: false })).toBe(
      false
    )
    expect(canPreloadAdaptedImage({ ...candidate, size: 7 * 1024 * 1024 }, { isMobile: false, saveData: false })).toBe(
      true
    )
  })

  it('rejects animated, unknown, data-saving, and slow-network candidates', () => {
    expect(canPreloadAdaptedImage({ ...candidate, isAnimated: true }, { isMobile: false, saveData: false })).toBe(false)
    expect(canPreloadAdaptedImage({ ...candidate, size: null }, { isMobile: false, saveData: false })).toBe(false)
    expect(canPreloadAdaptedImage(candidate, { isMobile: false, saveData: true })).toBe(false)
    expect(canPreloadAdaptedImage(candidate, { isMobile: false, saveData: false, effectiveType: 'slow-2g' })).toBe(
      false
    )
  })
})
