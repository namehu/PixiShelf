import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_SEARCH_DEFINITION_VERSION,
  archiveTitleQuerySchema,
  archiveTitleSearchTerm,
  archiveTitleUploaderLabel,
  matchesArchiveTitle
} from '../archive-search.js'
import { executionLaneForJobType } from '../job-types.js'

describe('title discovery query', () => {
  it('canonicalizes an OR set of accounts without using labels in the search', () => {
    const query = archiveTitleQuerySchema.parse({
      keyword: 'Match',
      uploaders: [{ uid: '456', displayName: 'Bob' }, { uid: '000123' }, { uid: '123', displayName: 'Alice' }]
    })
    expect(query.uploaders).toEqual([
      { uid: '123', displayName: 'Alice' },
      { uid: '456', displayName: 'Bob' }
    ])
    expect(archiveTitleSearchTerm(query)).toBe('title:"match" ~uploaduid:123 ~uploaduid:456')
    expect(archiveTitleUploaderLabel(query)).toBe('Alice、Bob')
    expect(
      archiveTitleSearchTerm(archiveTitleQuerySchema.parse({ keyword: 'Match', uploaders: [{ uid: '123' }] }))
    ).toBe('title:"match" uploaduid:123')
  })
  it.each([
    { uploaders: [] },
    { uploaders: [{ uid: '0' }] },
    { uploaders: [{ uid: '123 OR 456' }] },
    { uploaders: [{ uid: '123' }], uploaderUid: '456' },
    { uploaders: [{ uid: '123' }], uploaderName: 'Alice' },
    { uploaders: [{ uid: '123' }], uploaderDisplayName: 'Alice' },
    { uploaders: Array.from({ length: 11 }, (_, i) => ({ uid: String(i + 1) })) },
    { keyword: 'a'.repeat(160), uploaders: [{ uid: '1'.repeat(20) }, { uid: '2'.repeat(20) }] }
  ])('rejects invalid or oversized account sets %j', (value) => {
    expect(archiveTitleQuerySchema.safeParse({ keyword: 'Match', ...value }).success).toBe(false)
  })
  it('adds an exact name constraint without modifying legacy JSON or UID queries', () => {
    expect(ARCHIVE_SEARCH_DEFINITION_VERSION).toBe(3)
    const name = archiveTitleQuerySchema.parse({ keyword: 'Match', uploaderName: ' Ａlice ' })
    expect(archiveTitleSearchTerm(name)).toBe('title:"match" uploader:"alice"')
    expect(
      archiveTitleSearchTerm(
        archiveTitleQuerySchema.parse({ keyword: 'Match', uploaderUid: '123', uploaderDisplayName: 'Alice' })
      )
    ).toBe('title:"match" uploaduid:123')
    expect(archiveTitleQuerySchema.parse({ keyword: 'Match' })).not.toHaveProperty('uploaderName')
    expect(
      archiveTitleQuerySchema.safeParse({ keyword: 'Match', uploaderName: 'Alice', uploaderUid: '123' }).success
    ).toBe(false)
    expect(archiveTitleQuerySchema.safeParse({ keyword: 'Match', uploaderName: 'Alice" OR title:x' }).success).toBe(
      false
    )
  })
  it.each([
    ['CONTAINS', ' AbC ', ['prefix abc suffix'], true],
    ['STARTS_WITH', ' AbC ', [' ABC suffix '], true],
    ['STARTS_WITH', 'abc', ['prefix abc'], false],
    ['ENDS_WITH', 'abc', ['prefix ABC '], true],
    ['ENDS_WITH', 'abc', ['abc suffix'], false],
    ['CONTAINS', '中文', ['English', '日本語 中文'], true],
    ['CONTAINS', '[A].+$', ['literal [a].+$ text'], true],
    ['CONTAINS', '[A].+$', ['AAAA'], false],
    ['CONTAINS', 'a  b', ['a b'], false],
    ['CONTAINS', 'a  b', ['A  B'], true],
    ['CONTAINS', 'foo bar', ['foo', 'bar'], false]
  ] as const)('matches %s %s literally', (matchMode, keyword, titles, expected) => {
    expect(matchesArchiveTitle(archiveTitleQuerySchema.parse({ keyword, matchMode }), titles)).toBe(expected)
  })

  it.each(['', '   ', 'a" OR title:b', 'a*b', 'a%b', 'a％b', 'a\nb', 'a\u0000b', '[]'])(
    'rejects ambiguous remote text %j',
    (keyword) => {
      expect(archiveTitleQuerySchema.safeParse({ keyword }).success).toBe(false)
    }
  )

  it.each(['CONTAINS', 'STARTS_WITH', 'ENDS_WITH'] as const)(
    'accepts underscores and preserves literal matching for %s',
    (matchMode) => {
      const query = archiveTitleQuerySchema.parse({ keyword: ' Cornelia_winterhowl ', matchMode })
      expect(query.keyword).toBe('Cornelia_winterhowl')
      expect(archiveTitleSearchTerm(query)).toBe('title:"cornelia_winterhowl"')
      expect(matchesArchiveTitle(query, ['CORNELIA_WINTERHOWL'])).toBe(true)
      expect(matchesArchiveTitle(query, ['Cornelia winterhowl', 'CorneliaXwinterhowl'])).toBe(false)
    }
  )

  it('constructs only a title phrase and an optional numeric uploader constraint', () => {
    const query = archiveTitleQuerySchema.parse({ keyword: ' [ABC] 日本語 ', uploaderUid: ' 000123 ' })
    expect(query).toEqual({ keyword: '[ABC] 日本語', matchMode: 'CONTAINS', uploaderUid: '123' })
    expect(archiveTitleSearchTerm(query)).toBe('title:"[abc] 日本語" uploaduid:123')
    expect(archiveTitleQuerySchema.safeParse({ keyword: 'abc', uploaderUid: '0' }).success).toBe(false)
    expect(archiveTitleQuerySchema.safeParse({ keyword: 'abc', regex: true }).success).toBe(false)
    expect(executionLaneForJobType('ARCHIVE_SEARCH_SCAN')).toBe('ARCHIVE_RESOLVE')
  })
})
