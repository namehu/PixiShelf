import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { VisualSearchIndex, type SearchPage } from '../visual-search-index.ts'
import { compareProductionVisual, assignVisualPair, type VisualPage } from '../visual-matching.ts'
import { VisualViewIndex, hamming } from '../visual-experiment.ts'
import { readVisualMedia } from '../visual-reader.ts'
import { resolveMediaContentRoots } from '../../media-content/roots.ts'
import { scaleViews, scaleSha256, type ScaleShape } from './visual-scale-fixture.ts'
const cursor = { queryAfter: 0, queryImageId: 0, candidateAfter: 0, queryCompleted: 0 }
const evidenceFile = process.env.ARTWORK_DEDUP_V2_BENCHMARK_EVIDENCE
const realRoot = process.env.ARTWORK_DEDUP_V2_REAL_FEATURE_ROOT
const output = process.env.ARTWORK_DEDUP_V2_ORACLE_OUTPUT

type Published = { left: number; right: number; pages: Array<[string, number | null, number | null]> }
it.skipIf(!evidenceFile)('explains each changed benchmark page with a full cross-artwork comparison oracle', async () => {
  const report = JSON.parse(await readFile(evidenceFile!, 'utf8')) as {
    fixture: { shape: ScaleShape; fixtureDigest: string }; baseline: { artworkIds: number[]; imageIds: number[]; published: Published[] };
    cold: { published: Published[] }; differences: { changed: Published[] }
  }
  const explanations = []
  for (const change of report.differences.changed) {
    const artworks = [change.left, change.right]
    const groups = artworks.map(artworkId => {
      const start = report.baseline.artworkIds.indexOf(artworkId) * report.fixture.shape.groupSize
      return Array.from({ length: report.fixture.shape.groupSize }, (_, index): VisualPage => ({ artworkId, imageId: report.baseline.imageIds[start + index]!, index,
        views: scaleViews(start + index, report.fixture.shape), size: 100n, sha256: scaleSha256(start + index) }))
    })
    const pages = groups.flat(), search = new VisualSearchIndex(pages.map(page => ({ ...page, reused: false })))
    const actual = search.batch(cursor, 1000000, 1000, 1000000, Infinity)
    expect(actual.complete).toBe(true)
    const oracle = new Map<number, Set<number>>(), oldEdges = new Map<number, Set<number>>()
    const old = new VisualViewIndex()
    pages.forEach((page, i) => old.add(i, page.views))
    const missedByOld = []
    let oracleComparisons = 0
    for (const left of groups[0]!) {
      const retrieved = new Set(old.query(left.views, 1000000, 1000000).candidates.map(i => pages[i]!.imageId))
      for (const right of groups[1]!) {
        oracleComparisons++
        const result = compareProductionVisual(left.views, right.views)
        if (!result.matched) continue
        const ids = oracle.get(left.imageId) ?? new Set<number>(); ids.add(right.imageId); oracle.set(left.imageId, ids)
        if (retrieved.has(right.imageId)) { const legacy = oldEdges.get(left.imageId) ?? new Set<number>(); legacy.add(right.imageId); oldEdges.set(left.imageId, legacy) }
        else missedByOld.push({ leftImageId: left.imageId, rightImageId: right.imageId, leftIndex: left.index, rightIndex: right.index,
          regionDistances: left.views[0]!.feature.hashes.map((hash, region) => hamming(hash, right.views[0]!.feature.hashes[region]!)),
          sameFixtureSourcePage: left.index === right.index, matches: result.matches })
      }
    }
    expect(actual.edges.map(e => e.slice(2))).toEqual([...oracle].flatMap(([a, ids]) => [...ids].map(b => [a, b])))
    const normalize = (edges: Map<number, Set<number>>) => assignVisualPair(groups[0]!, groups[1]!, edges)!.pages.map(p => [p.kind, p.left?.imageId ?? null, p.right?.imageId ?? null])
    const newPair = report.cold.published.find(p => p.left === change.left && p.right === change.right)!
    const oldPair = report.baseline.published.find(p => p.left === change.left && p.right === change.right)!
    expect(normalize(oracle)).toEqual(newPair.pages)
    expect(normalize(oldEdges)).toEqual(oldPair.pages)
    const changedPages = newPair.pages.filter(page => !oldPair.pages.some(old => JSON.stringify(old) === JSON.stringify(page)))
    explanations.push({ artworks, oracleComparisons, oldMatchedEdges: [...oldEdges.values()].reduce((n, ids) => n + ids.size, 0), newMatchedEdges: actual.edges.length,
      missedByOld, changedPages, classification: 'Complete search exposes threshold collisions between distinct synthetic source pages; conservative unique-edge assignment leaves the affected true counterparts unmatched instead of publishing the ambiguous cross-pairs.' })
  }
  expect(explanations.length).toBeGreaterThan(0)
  if (output) await writeFile(path.join(output, 'benchmark-difference-oracle.json'), JSON.stringify({ fixtureDigest: report.fixture.fixtureDigest, explanations }, null, 2))
  console.info('VISUAL_V2_BENCHMARK_DIFFERENCE', JSON.stringify(explanations))
}, 30000)

it.skipIf(!realRoot)('matches the exhaustive production oracle on frozen real-image variants and negative templates', async () => {
  if (!realRoot!.startsWith('/private/tmp/')) throw new Error('Only the frozen isolated feature fixture is allowed')
  const manifest = JSON.parse(await readFile(path.join(realRoot!, 'samples.json'), 'utf8')) as { sourceGroups: number; independentArtworkFamilies: boolean; samples: Array<{ id: string; file: string }> }
  const roots = await resolveMediaContentRoots({ sourceRoot: realRoot!, archiveRoot: realRoot!, expectedPixivRootIdentity: null })
  const variants = ['jpeg-resize', 'local-black', 'local-white', 'border10', 'crop2.5', 'crop5', 'template-0', 'template-1', 'flat']
  const rows: Array<SearchPage & { label: string; family: string; variant: string; sha256: string }> = []
  for (const sample of manifest.samples) for (const variant of ['original', ...variants]) {
    const relativePath = variant === 'original' ? path.relative(realRoot!, sample.file) : `run-v2/${sample.id}-${variant}.png`
    const read = await readVisualMedia({ root: roots.source, relativePath, signal: new AbortController().signal })
    const id = rows.length + 1
    rows.push({ imageId: id, artworkId: id, views: read.views, reused: false, label: `${sample.id}:${variant}`, family: sample.id, variant, sha256: read.sha256 })
  }
  const index = new VisualSearchIndex(rows)
  const actual = index.batch(cursor, 1000000, 1000, 1000000, Infinity)
  const failedKnownTransformations: Array<{ left: string; right: string }> = []
  const oracle: number[][] = [], positives: Record<string, { cases: number; matched: number }> = {}, templateNegatives = [], crossInputMatches = []
  let comparisons = 0
  for (let a = 0; a < rows.length; a++) for (let b = a + 1; b < rows.length; b++) {
    const left = rows[a]!, right = rows[b]!, matched = compareProductionVisual(left.views, right.views).matched; comparisons++
    if (matched) oracle.push([left.artworkId, right.artworkId, left.imageId, right.imageId])
    if (left.family === right.family && left.variant === 'original' && !right.variant.startsWith('template') && right.variant !== 'flat') {
      const result = positives[right.variant] ?? { cases: 0, matched: 0 }; result.cases++; result.matched += Number(matched); positives[right.variant] = result
      if (!matched) failedKnownTransformations.push({ left: left.label, right: right.label })
    }
    if (left.family === right.family && left.variant === 'template-0' && right.variant === 'template-1') templateNegatives.push({ family: left.family, matched })
    if (left.family !== right.family && matched) crossInputMatches.push({ left: left.label, right: right.label })
    if (left.variant === 'flat' || right.variant === 'flat') expect(matched).toBe(false)
  }
  expect(actual.complete).toBe(true); expect(actual.edges).toEqual(oracle)
  expect(templateNegatives.every(row => !row.matched)).toBe(true)
  const old = new VisualViewIndex(); rows.forEach((row, i) => old.add(i, row.views))
  // These labels come from visual inspection of the frozen originals. They are
  // not blind annotations and this small shared-layout set is not independent.
  const realTemplateNegatives = [['fresh-02:original', 'fresh-04:original'], ['fresh-01:original', 'fresh-03:border10']].map(([a, b]) => {
    const left = rows.find(row => row.label === a)!, right = rows.find(row => row.label === b)!
    const comparison = compareProductionVisual(left.views, right.views)
    return { left: a, right: b, label: 'different text and different illustration on a common postcard layout', matched: comparison.matched, oldIndexRetrieved: old.query(left.views).candidates.includes(rows.indexOf(right)), matches: comparison.matches }
  })
  const report = { images: rows.length, sourceInputs: manifest.samples.length, sourceGroups: manifest.sourceGroups, independentArtworkFamilies: manifest.independentArtworkFamilies, exhaustiveComparisons: comparisons, oracleMatches: oracle.length,
    indexMatches: actual.edges.length, missedOracleEdges: 0, extraOracleEdges: 0, nodeVisits: actual.nodeVisits,
    positives, failedKnownTransformations, templateNegatives, realTemplateNegatives, crossInputMatches, inputs: rows.map(({ label, sha256 }) => ({ label, sha256 })),
    limitation: 'Nine source inputs come from three source groups and are not independent artwork families. Known transformations and synthetic template negatives have construction labels; the two real common-layout negatives were visually inspected after comparison, not blindly annotated. Cross-input matches include translations and edited variants, so they cannot all be classified as false positives. Search completeness is measured against the unchanged production comparator and is not semantic precision.' }
  if (output) await writeFile(path.join(output, 'real-feature-oracle.json'), JSON.stringify(report, null, 2))
  console.info('VISUAL_V2_REAL_FEATURE_ORACLE', JSON.stringify({ ...report, inputs: undefined, crossInputMatches: crossInputMatches.length }))
}, 60000)
