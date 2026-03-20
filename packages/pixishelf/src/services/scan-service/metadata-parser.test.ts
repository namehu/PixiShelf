import { describe, expect, it } from 'vitest'
import { extractArtworkIdFromFilename, isMetadataFile } from './metadata-parser'

describe('extractArtworkIdFromFilename', () => {
  it('should parse id from standard metadata filename', () => {
    expect(extractArtworkIdFromFilename('142456503-meta.txt')).toBe('142456503')
  })

  it('should parse id from paged metadata filename', () => {
    expect(extractArtworkIdFromFilename('142456503_p0-meta.txt')).toBe('142456503')
  })

  it('should return null for invalid metadata filename', () => {
    expect(extractArtworkIdFromFilename('foo-meta.txt')).toBeNull()
  })
})

describe('isMetadataFile', () => {
  it('should identify paged metadata filename as metadata file', () => {
    expect(isMetadataFile('142456503_p2-meta.txt')).toBe(true)
  })
})
