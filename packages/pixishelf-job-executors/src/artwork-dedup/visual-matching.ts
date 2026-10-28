import { createHash } from 'node:crypto'
import { compareVisualViews, VISUAL_PARAMETER_PRESETS, VisualViewIndex, type VisualView } from './visual-experiment.ts'
import { ARTWORK_DEDUP_VISUAL_EVIDENCE_VERSION } from '@pixishelf/db'
export const VISUAL_ALGORITHM_VERSION = ARTWORK_DEDUP_VISUAL_EVIDENCE_VERSION
export const VISUAL_NORMALIZATION_VERSION = 'exif-srgb-white-gray96-white245-995-edge20-crop5-10-v1'
export const VISUAL_LIMITS = Object.freeze({ files: 10_000, artworkFiles: 2_000, postings: 1_600_000,
  queryPostings: 20_000, queryCandidates: 2_000, comparisons: 200_000, edgesPerPair: 200_000, artworkPairs: 1_000,
  bytes: 32 * 1024 * 1024, pixels: 40_000_000, readMs: 10_000 })
export function compareProductionVisual(a: readonly VisualView[], b: readonly VisualView[]) {
  const result = compareVisualViews(a, b, VISUAL_PARAMETER_PRESETS[1]!)
  // Cropping multiplies opportunities for an accidental global match. A crop must
  // preserve at least one informative local region; the historical pilot stays reproducible.
  const matches = result.matches.filter(m => (m.left === 'original' && m.right === 'original') || m.agreeingRegions >= 1)
  return { ...result, matched: matches.length > 0, matches }
}
export function visualIdentity(row: {
  imageId: number; sourceRevision: bigint; sourcePath: string; rootIdentity: string; directoryId: string;
  directoryGeneration: bigint; canonicalPath: string; sha256: string | null; size: bigint;
  mtimeNs: bigint | null; ctimeNs: bigint | null; deviceId: bigint | null; inode: bigint | null
}) {
  return createHash('sha256').update(JSON.stringify([row.imageId, row.sourcePath, row.sourceRevision.toString(),
    row.rootIdentity, row.directoryId, row.directoryGeneration.toString(), row.canonicalPath, row.sha256,
    ...[row.size, row.mtimeNs, row.ctimeNs, row.deviceId, row.inode].map(v => v?.toString() ?? null)])).digest('hex')
}
export function validVisualViews(value: unknown): value is VisualView[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every(v =>
    v && typeof v.name === 'string' && v.feature && Number.isSafeInteger(v.feature.width) && v.feature.width > 0 &&
    Number.isSafeInteger(v.feature.height) && v.feature.height > 0 && Array.isArray(v.feature.hashes) &&
    v.feature.hashes.length === 10 && v.feature.hashes.every((h: unknown) => typeof h === 'string' && /^[a-f0-9]{16}$/.test(h)) &&
    Array.isArray(v.feature.information) && v.feature.information.length === 10 &&
    v.feature.information.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0))
}
/** Only deterministic, content-verified exclusions are reusable; I/O and decoder failures are not. */
export interface VisualExclusion { kind: 'visual-exclusion'; version: 1; reason: 'MULTI_FRAME' }
export function validVisualExclusion(value: unknown): value is VisualExclusion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return Object.keys(v).length === 3 && v.kind === 'visual-exclusion' && v.version === 1 && v.reason === 'MULTI_FRAME'
}
export interface VisualPage { imageId: number; artworkId: number; index: number; size: bigint; sha256: string; views: VisualView[] }
export interface VisualPairEvidence { leftArtworkId: number; rightArtworkId: number; pages: { kind: 'EXACT' | 'SIMILAR' | 'UNMATCHED'; left: VisualPage | null; right: VisualPage | null }[] }
export interface VisualRelationReuse { artworks: Set<number>; candidatePairs: string[]; pairs: VisualPairEvidence[] }
export interface VisualMatchingResult { pairs: VisualPairEvidence[]; reason: string | null; candidatePairs?: string[]; reusedComparisons?: number; comparedComparisons?: number }
/** Finite run-wide sparse matching. Never returns a truncated subset on budget exhaustion. */
export async function matchVisualPages(pages: VisualPage[], checkpoint: () => Promise<void>, reuse?: VisualRelationReuse): Promise<VisualMatchingResult> {
  const fail = (reason: string) => ({ pairs: [], reason })
  if (pages.length > VISUAL_LIMITS.files) return fail('VISUAL_FILE_BUDGET')
  const byArtwork = new Map<number, VisualPage[]>()
  const index = new VisualViewIndex()
  let postings = 0
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!
    const group = byArtwork.get(page.artworkId) ?? []
    group.push(page); byArtwork.set(page.artworkId, group)
    if (group.length > VISUAL_LIMITS.artworkFiles) return fail('VISUAL_ARTWORK_BUDGET')
    postings += page.views.reduce((sum, view) => sum + view.feature.information.filter(n => n >= 8).length * 4, 0)
    if (postings > VISUAL_LIMITS.postings) return fail('VISUAL_INDEX_BUDGET')
    index.add(i, page.views)
    if (i % 100 === 0) await checkpoint()
  }
  const candidates = new Map<string, { left: number; right: number; edges: Map<number, Set<number>> }>()
  // Old candidates include below-threshold pairs. They still consume the current
  // pair budget, although unchanged inputs need no distance or assignment work.
  for (const key of reuse?.candidatePairs ?? []) {
    const [left, right] = key.split(':').map(Number)
    if (!left || !right || left >= right || !byArtwork.has(left) || !byArtwork.has(right) || !reuse!.artworks.has(left) || !reuse!.artworks.has(right)) continue
    if (!candidates.has(key) && candidates.size >= VISUAL_LIMITS.artworkPairs) return fail('VISUAL_PAIR_BUDGET')
    candidates.set(key, { left, right, edges: new Map() })
  }
  let comparisons = 0, reusedComparisons = 0, comparedComparisons = 0
  for (let i = 0; i < pages.length; i++) {
    const a = pages[i]!
    const query = index.query(a.views, VISUAL_LIMITS.queryPostings, VISUAL_LIMITS.queryCandidates)
    if (query.status === 'incomplete') return fail(`VISUAL_${query.reason === 'posting-budget' ? 'POSTING' : 'CANDIDATE'}_BUDGET`)
    for (const j of query.candidates) {
      const b = pages[j]!
      if (a.artworkId >= b.artworkId) continue
      if (++comparisons > VISUAL_LIMITS.comparisons) return fail('VISUAL_COMPARISON_BUDGET')
      // All current queries/budgets still run: new dense buckets cannot turn an
      // old complete negative into permission to publish a truncated new scan.
      if (reuse?.artworks.has(a.artworkId) && reuse.artworks.has(b.artworkId)) { reusedComparisons++; continue }
      comparedComparisons++
      if (!compareProductionVisual(a.views, b.views).matched) continue
      const key = `${a.artworkId}:${b.artworkId}`
      if (!candidates.has(key)) {
        if (candidates.size >= VISUAL_LIMITS.artworkPairs) return fail('VISUAL_PAIR_BUDGET')
        candidates.set(key, { left: a.artworkId, right: b.artworkId, edges: new Map() })
      }
      const edges = candidates.get(key)!.edges
      const set = edges.get(a.imageId) ?? new Set<number>(); set.add(b.imageId); edges.set(a.imageId, set)
    }
    if (i % 20 === 0) await checkpoint()
  }
  const pairs: VisualPairEvidence[] = [...(reuse?.pairs ?? [])]
  for (const candidate of candidates.values()) {
    if (reuse?.artworks.has(candidate.left) && reuse.artworks.has(candidate.right)) continue
    const left = byArtwork.get(candidate.left)!, right = byArtwork.get(candidate.right)!
    const evidence = assignVisualPair(left, right, candidate.edges)
    if (evidence) pairs.push(evidence)
    await checkpoint()
  }
  return { pairs, reason: null, candidatePairs: [...candidates.keys()], reusedComparisons, comparedComparisons }
}

/** One complete pair only; both engines share the exact occurrence/unique-edge rules. */
export function assignVisualPair(left: VisualPage[], right: VisualPage[], candidateEdges: Map<number, Set<number>>): VisualPairEvidence | null {
    const used = new Set<number>(), paired = new Map<number, VisualPage>()
    const exact = new Map<string, VisualPage[]>()
    for (const page of right) { const key = `${page.size}:${page.sha256}`; const list = exact.get(key) ?? []; list.push(page); exact.set(key, list) }
    // Byte-identical originals take precedence and consume one occurrence each.
    for (const page of left) { const match = exact.get(`${page.size}:${page.sha256}`)?.shift(); if (match) { paired.set(page.imageId, match); used.add(match.imageId) } }
    const originalExact = new Set(paired.keys())
    // Conservative unique visual edges avoid silently resolving ambiguous repeated pages.
    const remaining = left.filter(p => !paired.has(p.imageId))
    const inbound = new Map<number, number>()
    const edges = new Map<number, VisualPage[]>()
    const rightById = new Map(right.map(p => [p.imageId, p]))
    for (const page of remaining) {
      const possible = [...(candidateEdges.get(page.imageId) ?? [])].filter(id => !used.has(id)).map(id => rightById.get(id)!)
      edges.set(page.imageId, possible)
      for (const p of possible) inbound.set(p.imageId, (inbound.get(p.imageId) ?? 0) + 1)
    }
    for (const page of remaining) { const possible = edges.get(page.imageId)!; if (possible.length === 1 && inbound.get(possible[0]!.imageId) === 1) { paired.set(page.imageId, possible[0]!); used.add(possible[0]!.imageId) } }
    if (paired.size / Math.min(left.length, right.length) < 0.8 || paired.size === originalExact.size) return null
    const evidence: VisualPairEvidence['pages'] = left.map(page => ({ left: page, right: paired.get(page.imageId) ?? null,
      kind: originalExact.has(page.imageId) ? 'EXACT' : paired.has(page.imageId) ? 'SIMILAR' : 'UNMATCHED' }))
    evidence.push(...right.filter(p => !used.has(p.imageId)).map(page => ({ left: null, right: page, kind: 'UNMATCHED' as const })))
    return { leftArtworkId: left[0]!.artworkId, rightArtworkId: right[0]!.artworkId, pages: evidence }
}
