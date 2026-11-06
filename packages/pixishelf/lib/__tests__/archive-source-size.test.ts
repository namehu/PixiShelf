import { describe, expect, it } from 'vitest'
import { formatArchiveSourceSize } from '../archive-source-size'

describe('source gallery size labels', () => {
  it('uses binary units and two decimal places for an entire-gallery estimate', () => {
    expect(formatArchiveSourceSize(1116691497)).toBe('1.04 GiB')
    expect(formatArchiveSourceSize(4670970)).toBe('4.45 MiB')
    expect(formatArchiveSourceSize(null)).toBe('未知')
  })
})
