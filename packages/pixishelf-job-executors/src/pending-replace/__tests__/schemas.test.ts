import { describe, expect, it } from 'vitest'
import {
  MAX_PENDING_REPLACE_ENTRIES,
  MAX_PENDING_REPLACE_WARNINGS,
  parsePendingReplaceManifest,
  parsePendingReplaceMedia,
  parsePendingReplaceTargets,
  parsePendingReplaceWarnings
} from '../schemas.js'

const digest = 'a'.repeat(64)

describe('pending replacement persisted schemas', () => {
  it('accepts exactly 1234 strict manifest entries and rejects 1235', () => {
    const entries = Array.from({ length: MAX_PENDING_REPLACE_ENTRIES }, (_, index) => ({
      name: `${index}.jpg`,
      size: index,
      mtimeMs: index,
      sha256: digest,
      kind: 'media' as const,
      targetName: `123_p${index}.jpg`
    }))
    expect(parsePendingReplaceManifest(entries)).toHaveLength(1_234)
    expect(() => parsePendingReplaceManifest([...entries, entries[0]!])).toThrow('invalid shape')
  })

  it('accepts exactly 123 warnings and rejects 124', () => {
    const warnings = Array.from({ length: MAX_PENDING_REPLACE_WARNINGS }, () => 'bounded warning')
    expect(parsePendingReplaceWarnings(warnings)).toHaveLength(123)
    expect(() => parsePendingReplaceWarnings([...warnings, 'overflow'])).toThrow('invalid shape')
  })

  it('rejects unknown fields, missing digests, excessive depth, and oversized JSON', () => {
    expect(() =>
      parsePendingReplaceManifest([{ name: 'a.jpg', size: 1, mtimeMs: 1, sha256: digest, kind: 'media', secret: 'x' }])
    ).toThrow('invalid shape')
    expect(() => parsePendingReplaceManifest([{ name: 'a.jpg', size: 1, mtimeMs: 1, kind: 'media' }])).toThrow(
      'invalid shape'
    )
    expect(() => parsePendingReplaceWarnings([[[[[[[[[['too deep']]]]]]]]]])).toThrow('depth limit')
    expect(() => parsePendingReplaceWarnings(['x'.repeat(2_000)], 100)).toThrow('byte limit')
  })

  it('rejects case-folded duplicate source, target, order, and backup identities', () => {
    const media = (sourceName: string, targetName: string, order: number) => ({
      sourceName,
      targetName,
      path: `/pending-replaces/${sourceName}`,
      size: 1,
      sha256: digest,
      width: 1,
      height: 1,
      order,
      mtimeMs: 1,
      mediaType: 'IMAGE' as const
    })
    expect(() => parsePendingReplaceMedia([media('a.jpg', '1_p0.jpg', 0), media('A.JPG', '1_p1.jpg', 1)])).toThrow(
      'invalid shape'
    )
    expect(() => parsePendingReplaceMedia([media('a.jpg', '1_p0.jpg', 0), media('b.jpg', '1_P0.JPG', 1)])).toThrow(
      'invalid shape'
    )
    expect(() => parsePendingReplaceMedia([media('a.jpg', '1_p0.jpg', 0), media('b.jpg', '1_p1.jpg', 0)])).toThrow(
      'invalid shape'
    )
    expect(() =>
      parsePendingReplaceTargets([
        { name: 'old.jpg', size: 1, mtimeMs: 1, sha256: digest },
        { name: 'OLD.JPG', size: 1, mtimeMs: 1, sha256: digest }
      ])
    ).toThrow('invalid shape')
  })
})
