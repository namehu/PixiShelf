import { describe, expect, it } from 'vitest'
import { artistMappingInputDigest, metadataInputDigest } from '../digests.js'

describe('frozen input digests', () => {
  it('uses ordinal ordering and includes all identity fields', () => {
    const rows = [
      { ordinal: 1, relativePath: 'b/2-meta.json', contentHash: 'b'.repeat(64) },
      { ordinal: 0, relativePath: 'a/1-meta.json', contentHash: 'a'.repeat(64) }
    ]
    expect(metadataInputDigest(rows)).toBe(metadataInputDigest([...rows].reverse()))
    expect(metadataInputDigest(rows)).not.toBe(
      metadataInputDigest(rows.map((row) => (row.ordinal === 0 ? { ...row, relativePath: 'changed' } : row)))
    )
  })

  it('matches the documented local mapping canonical row stream', () => {
    const rows = [
      { ordinal: 1, artistDirectory: '乙', artistId: 2 },
      { ordinal: 0, artistDirectory: '甲', artistId: 1 }
    ]
    expect(artistMappingInputDigest(rows)).toMatch(/^[a-f0-9]{64}$/)
    expect(artistMappingInputDigest(rows)).not.toBe(
      artistMappingInputDigest([{ ordinal: 0, artistDirectory: '甲', artistId: 2 }, rows[0]!])
    )
  })
})
