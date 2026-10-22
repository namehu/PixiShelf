import { describe, expect, it } from 'vitest'
import { archiveTitleQuerySchema } from '../archive-search.ts'
import {
  archiveTitleAccepted,
  archiveTitleEvidenceFromCatalog,
  archiveTitleQueryIdentity,
  archiveTitleRulesSchema,
  archiveTitleConditionMatchRanges,
  canonicalArchiveTitleRules,
  decodeArchiveTitle,
  evaluateArchiveTitleRules,
  legacyArchiveTitleRules,
  type ArchiveTitleRules
} from '../archive-title-rules.ts'

const rules: ArchiveTitleRules = {
  version: 1,
  any: [
    { operator: 'CONTAINS', text: '[RAG]' },
    { operator: 'CONTAINS', text: '[r18AnimeGirls/RAG]' }
  ],
  all: [],
  none: []
}
const evaluate = (titles: string[], input = rules) => evaluateArchiveTitleRules(input, { origin: 'REMOTE', titles })

describe('explicit archive title rules', () => {
  it('accepts explicit markers and rejects substring coincidences', () => {
    expect(evaluate(['  [rAg] Test  ']).matched).toBe(true)
    expect(evaluate(['[r18AnimeGirls/RAG] Test']).matched).toBe(true)
    expect(evaluate(['[Another Artist] Ragnarok']).matched).toBe(false)
    expect(evaluate(['Rag House']).matched).toBe(false)
  })
  it('does not assemble positive conditions from different language titles', () => {
    const composite: ArchiveTitleRules = { ...rules, all: [{ operator: 'CONTAINS', text: 'Endfield' }] }
    expect(evaluate(['[RAG] 中文标题', '[Other] Endfield'], composite).matched).toBe(false)
    expect(evaluate(['中文标题', '[RAG] Endfield'], composite)).toMatchObject({ matched: true, titleIndex: 1 })
  })
  it('vetoes an exclusion found in either title', () => {
    expect(
      evaluate(['[RAG] Test', 'Excluded'], { ...rules, none: [{ operator: 'EQUALS', text: 'excluded' }] })
    ).toMatchObject({ matched: false, reason: 'EXCLUDED', titleIndex: 1 })
  })
  it.each([
    ['[RAG] test', true],
    ['Ragnarok', false],
    ['RAG_01', false],
    ['中文RAG', false],
    ['RAG\u0301', false],
    ['😀RAG!', true],
    ['Ragged RAG', true]
  ])('uses Unicode word boundaries for %s', (title, expected) => {
    expect(
      evaluate([title as string], { version: 1, any: [{ operator: 'WHOLE_WORD', text: 'rag' }], all: [], none: [] })
        .matched
    ).toBe(expected)
  })
  it('decodes once, keeps internal whitespace and treats operator-like text literally', () => {
    const exact: ArchiveTitleRules = { version: 1, any: [{ operator: 'EQUALS', text: 'a  & b_*%' }], all: [], none: [] }
    expect(evaluate([' A  &amp; b_*% '], exact).matched).toBe(true)
    expect(evaluate(['A &amp; b_*%'], exact).matched).toBe(false)
    expect(decodeArchiveTitle('&amp;lt; &#x110000; &#55296;')).toBe('&lt; \uFFFD \uFFFD')
    expect(decodeArchiveTitle('&eacute;&nbsp;&lbrack;RAG&rbrack;')).toBe('é\u00a0[RAG]')
  })
  it('keeps manual decisions separate and cannot override an uploader mismatch', () => {
    const rejected = evaluate(['Ragnarok'])
    expect(archiveTitleAccepted(rejected, 'INCLUDE')).toBe(true)
    expect(rejected.matched).toBe(false)
    expect(archiveTitleAccepted(evaluate(['[RAG]']), 'EXCLUDE')).toBe(false)
    expect(archiveTitleAccepted({ matched: true, uploaderMatches: false }, 'INCLUDE')).toBe(false)
  })
  it('retains evidence origin and does not invent missing titles', () => {
    expect(
      archiveTitleEvidenceFromCatalog({ comparisonSnapshot: { titles: { display: '[RAG]', aliases: ['Alias'] } } })
    ).toEqual({ origin: 'HISTORICAL', titles: ['[RAG]', 'Alias'] })
    expect(evaluateArchiveTitleRules(rules, archiveTitleEvidenceFromCatalog({})).reason).toBe('MISSING_TITLE')
  })
  it('keeps legacy identities and canonicalizes composite condition order', () => {
    const query = archiveTitleQuerySchema.parse({ keyword: 'RAG' })
    expect(archiveTitleQueryIdentity(query, legacyArchiveTitleRules(query))).toBe('["e-hentai","rag","CONTAINS",null]')
    expect(archiveTitleQueryIdentity(query, rules)).toBe(
      archiveTitleQueryIdentity(query, { ...rules, any: [...rules.any].reverse() })
    )
  })

  it('defaults to ignoring case, with independent case-sensitive positive and negative conditions', () => {
    const exactCase: ArchiveTitleRules = {
      version: 2,
      any: [{ operator: 'WHOLE_WORD', text: 'RAG', ignoreCase: false }],
      all: [],
      none: []
    }
    expect(evaluate(['[RAG] Title'], exactCase).matched).toBe(true)
    expect(evaluate(['[rag] Title'], exactCase).matched).toBe(false)
    expect(evaluate(['[rag] Title'], { ...exactCase, any: [{ ...exactCase.any[0]!, ignoreCase: true }] }).matched).toBe(
      true
    )
    const withExclusion = {
      ...exactCase,
      all: [{ operator: 'CONTAINS' as const, text: 'title' }],
      none: [{ operator: 'CONTAINS' as const, text: 'SKIP', ignoreCase: false }]
    }
    expect(evaluate(['[RAG] Title skip'], withExclusion).matched).toBe(true)
    expect(evaluate(['[RAG] Title', 'SKIP'], withExclusion).reason).toBe('EXCLUDED')
  })

  it.each(['CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'EQUALS'] as const)('honors case for %s', (operator) => {
    const input: ArchiveTitleRules = {
      version: 2,
      any: [{ operator, text: 'RAG', ignoreCase: false }],
      all: [],
      none: []
    }
    expect(evaluate([' RAG '], input).matched).toBe(true)
    expect(evaluate([' rag '], input).matched).toBe(false)
  })

  it('uses safe regex search with groups, alternatives, classes, Unicode and independent exclusions', () => {
    const input: ArchiveTitleRules = {
      version: 2,
      any: [{ operator: 'REGEX', text: '^\\[(RAG|r18AnimeGirls/RAG)\\]', ignoreCase: false }],
      all: [{ operator: 'REGEX', text: '\\p{Han}+' }],
      none: [{ operator: 'REGEX', text: 'skip\\d+$' }]
    }
    expect(evaluate(['[RAG] 标题'], input).matched).toBe(true)
    expect(evaluate(['[r18AnimeGirls/RAG] 标题'], input).matched).toBe(true)
    expect(evaluate(['[rag] 标题'], input).matched).toBe(false)
    expect(evaluate(['[Other] Ragnarok 标题'], input).matched).toBe(false)
    expect(evaluate(['[RAG] 标题', 'SKIP2'], input).reason).toBe('EXCLUDED')
    expect(evaluate(['[RAG]', '标题'], input).matched).toBe(false)
  })

  it.each([
    '[',
    '(?=RAG)',
    '(?<=RAG)',
    '(RAG)\\1',
    '(?i)rag',
    '(?-i:RAG)',
    '\\Q[\\E(?i)rag',
    '\\Q[\\E(?-i)RAG',
    '[[:alpha:]](?i)rag'
  ])('rejects invalid or unsupported regex %s', (text) => {
    expect(
      archiveTitleRulesSchema.safeParse({ version: 2, any: [{ operator: 'REGEX', text }], all: [], none: [] }).success
    ).toBe(false)
  })

  it.each(['\\Q(?i)\\E', '[](?i)]', '[[:alpha:](?i)]'])('allows literal flag-like text in %s', (text) => {
    expect(
      archiveTitleRulesSchema.safeParse({ version: 2, any: [{ operator: 'REGEX', text }], all: [], none: [] }).success
    ).toBe(true)
  })

  it('evaluates pathological backtracking patterns without backtracking and handles zero-length matches', () => {
    const input: ArchiveTitleRules = { version: 2, any: [{ operator: 'REGEX', text: '(a+)+$' }], all: [], none: [] }
    expect(evaluate(['a'.repeat(50_000) + '!'], input).matched).toBe(false)
    expect(evaluate(['[RAG]'], { ...input, any: [{ operator: 'REGEX', text: '^' }] })).toMatchObject({
      matched: true,
      matchRanges: [{ start: 0, end: 0 }]
    })
    expect(evaluate(['', 'Other'], { ...input, any: [{ operator: 'REGEX', text: '^$' }] }).matched).toBe(false)
  })

  it('preserves regex source, significant case and old query identities during canonicalization', () => {
    const query = archiveTitleQuerySchema.parse({ keyword: 'RAG' })
    const legacy = legacyArchiveTitleRules(query)
    expect(
      archiveTitleQueryIdentity(query, { ...legacy, version: 2, any: [{ ...legacy.any[0]!, ignoreCase: true }] })
    ).toBe(archiveTitleQueryIdentity(query, legacy))
    const sensitive: ArchiveTitleRules = { ...legacy, version: 2, any: [{ ...legacy.any[0]!, ignoreCase: false }] }
    expect(archiveTitleQueryIdentity(query, sensitive)).not.toBe(archiveTitleQueryIdentity(query, legacy))
    expect(archiveTitleQueryIdentity(query, sensitive)).not.toBe(
      archiveTitleQueryIdentity(query, { ...sensitive, any: [{ ...sensitive.any[0]!, text: 'rag' }] })
    )
    const regex: ArchiveTitleRules = { ...legacy, version: 2, any: [{ operator: 'REGEX', text: ' \\D+[A-Z] ' }] }
    expect(canonicalArchiveTitleRules(regex).any[0]!.text).toBe(' \\D+[A-Z] ')
    expect(archiveTitleQueryIdentity(query, regex)).not.toBe(
      archiveTitleQueryIdentity(query, { ...regex, any: [{ operator: 'REGEX', text: ' \\d+[a-z] ' }] })
    )
    expect(archiveTitleRulesSchema.safeParse({ ...sensitive, version: 1 }).success).toBe(false)
  })

  it('records exact decoded-title highlight offsets across bilingual, entity and Unicode cases', () => {
    const raw = '  😀 &amp; [RAG] Endfield  '
    const result = evaluate(['別のタイトル', raw], { ...rules, all: [{ operator: 'CONTAINS', text: 'Endfield' }] })
    expect(result.titleIndex).toBe(1)
    expect(result.matchRanges!.map(({ start, end }) => decodeArchiveTitle(raw).slice(start, end))).toEqual([
      '[RAG]',
      'Endfield'
    ])
    expect(archiveTitleConditionMatchRanges('İ [RAG]', { operator: 'CONTAINS', text: '[rag]' })).toEqual([
      { start: 2, end: 7 }
    ])
    expect(archiveTitleConditionMatchRanges(' 😀 &#91;RAG&#93; ', { operator: 'REGEX', text: 'RAG' })).toEqual([
      { start: 5, end: 8 }
    ])
    expect(archiveTitleConditionMatchRanges('Ragged RAG [RAG]', { operator: 'WHOLE_WORD', text: 'RAG' })).toEqual([
      { start: 7, end: 10 },
      { start: 12, end: 15 }
    ])
  })
})
