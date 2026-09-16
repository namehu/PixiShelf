import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_SEARCH_DEFINITION_VERSION,
  archiveTitleQuerySchema,
  archiveTitleSearchTerm,
  matchesArchiveTitle
} from '../archive-search.js'
import { executionLaneForJobType } from '../job-types.js'

describe('title discovery query', () => {
  it('adds an exact name constraint without modifying legacy JSON or UID queries', () => {
    expect(ARCHIVE_SEARCH_DEFINITION_VERSION).toBe(2)
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

  it.each(['', '   ', 'a" OR title:b', 'a*b', 'a_b', 'a%b', 'a％b', 'a\nb', 'a\u0000b', '[]'])(
    'rejects ambiguous remote text %j',
    (keyword) => {
      expect(archiveTitleQuerySchema.safeParse({ keyword }).success).toBe(false)
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
