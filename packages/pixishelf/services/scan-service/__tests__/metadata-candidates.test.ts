import { describe, expect, it, vi } from 'vitest'
import { selectPreferredMetadataFiles, type MetadataCandidateFile } from '../metadata-candidates'

function candidate(path: string, artworkId: string, createdAt = new Date('2026-06-17T00:00:00Z')): MetadataCandidateFile {
  const name = path.split('/').pop() || path
  return {
    name,
    artworkId,
    path,
    createdAt,
    metadataFormat: name.endsWith('.json') ? 'json' : 'txt'
  }
}

describe('selectPreferredMetadataFiles', () => {
  it('should prefer json metadata over txt for the same artwork', () => {
    const warn = vi.fn()
    const result = selectPreferredMetadataFiles(
      [candidate('/scan/145867935-meta.txt', '145867935'), candidate('/scan/145867935-meta.json', '145867935')],
      warn
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe('/scan/145867935-meta.json')
    expect(warn).not.toHaveBeenCalled()
  })

  it('should fall back to txt when json metadata is absent', () => {
    const result = selectPreferredMetadataFiles([candidate('/scan/145867935-meta.txt', '145867935')], vi.fn())

    expect(result).toHaveLength(1)
    expect(result[0]?.metadataFormat).toBe('txt')
  })

  it('should keep one json candidate and report duplicates when multiple json files exist', () => {
    const warn = vi.fn()
    const result = selectPreferredMetadataFiles(
      [
        candidate('/scan/a/145867935-meta.json', '145867935'),
        candidate('/scan/b/145867935_p0-meta.json', '145867935'),
        candidate('/scan/a/145867935-meta.txt', '145867935')
      ],
      warn
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe('/scan/a/145867935-meta.json')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate artworkId found: 145867935'))
  })
})
