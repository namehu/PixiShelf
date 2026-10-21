import { describe, expect, it } from 'vitest'
import { archiveTitleQuerySchema } from '../archive-search.ts'
import {
  archiveTitleAccepted,
  archiveTitleEvidenceFromCatalog,
  archiveTitleQueryIdentity,
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
})
