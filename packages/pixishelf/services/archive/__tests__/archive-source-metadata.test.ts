import { describe, expect, it } from 'vitest'
import { archiveSourceSizeBytes } from '../archive-source-metadata'

describe('entire-gallery source size', () => {
  it('keeps remote entire-gallery bytes separate from partial downloaded media bytes', () => {
    expect(archiveSourceSizeBytes({ normalizedMetadata: { fileSize: 1048576 }, media: [{ byteCount: '100' }] })).toBe(
      1048576
    )
    expect(archiveSourceSizeBytes({ fileSize: 1048576, completedItems: 20 })).toBe(1048576)
  })
  it('leaves absent source size unknown instead of using downloaded totals or interpreting strings', () => {
    expect(archiveSourceSizeBytes({ totalBytes: 1000 })).toBeNull()
    expect(archiveSourceSizeBytes({ fileSize: '1000' })).toBeNull()
    expect(archiveSourceSizeBytes({ fileSize: 0 })).toBeNull()
  })
})
