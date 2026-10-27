import { createHash } from 'node:crypto'
import type { VisualView } from '../visual-experiment.ts'

export const SCALE_FIXTURE_VERSION = 'f03-scale-permuted-bands-v1'
export const SCALE_COUNTS = [5_000, 100_000] as const
export interface ScaleShape { count: number; groupSize: number; domain: number; artworkCount: number; partialSource: number; partialTarget: number }
export interface ScaleIdentity { shape: ScaleShape; artworkIds: number[]; imageIds: number[] }
export interface ScalePair { left: number; right: number; pages: Array<[string, number | null, number | null]> }
export interface ScaleOracle { comparisons: number; candidateSlots: number; candidates: Array<{ left: number; right: number; edges: Array<[number, number]> }>; pairs: ScalePair[]; postings: number; maxCandidates: number; maxPostingVisits: number; digest: string }

export function scaleShape(count: number): ScaleShape {
  if (!SCALE_COUNTS.some(value => value === count)) throw new Error('Only the 5k probe and explicit 100k fixture are supported')
  const groupSize = count === 5_000 ? 250 : 1_000
  const artworkCount = count / groupSize
  return { count, groupSize, domain: 2 ** Math.ceil(Math.log2(count / 2)), artworkCount, partialSource: Math.floor(artworkCount / 2), partialTarget: artworkCount - 2 }
}
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)).digest('hex')
}
function salt(region: number, band: number, domain: number): number {
  // Distinct nonzero cross-domain masks keep each query's candidate set finite.
  return ((region * 4 + band + 1) * 1499) & (domain - 1)
}
function permute16(value: number): number {
  value = ((value ^ (value >>> 7)) * 40503) & 0xffff
  return value ^ (value >>> 9)
}
function segments(seed: number, shape: ScaleShape): Uint16Array {
  const output = new Uint16Array(40), low = seed & (shape.domain - 1), group = Math.floor(seed / shape.domain)
  for (let region = 0; region < 10; region++) for (let band = 0; band < 4; band++) {
    const position = region * 4 + band
    output[position] = permute16(low ^ (group ? salt(region, band, shape.domain) : 0) ^ ((position * 2731) & 0xffff))
  }
  return output
}
export function seedForOrdinal(ordinal: number, shape: ScaleShape): number {
  const artwork = Math.floor(ordinal / shape.groupSize), page = ordinal % shape.groupSize
  if (artwork === shape.artworkCount - 1) return page
  if (artwork === shape.partialTarget && page < shape.groupSize * 0.8) return shape.partialSource * shape.groupSize + page
  return ordinal
}
export function scaleViews(ordinal: number, shape: ScaleShape): VisualView[] {
  const values = segments(seedForOrdinal(ordinal, shape), shape)
  return [{ name: 'original', feature: { width: 96, height: 96, hashes: Array.from({ length: 10 }, (_, region) =>
    Array.from(values.slice(region * 4, region * 4 + 4), value => value.toString(16).padStart(4, '0')).join('')), information: Array<number>(10).fill(30) } }]
}
export function scaleSha256(ordinal: number): string {
  return createHash('sha256').update(`${SCALE_FIXTURE_VERSION}:original:${ordinal}`).digest('hex')
}
function occurrences(seed: number, shape: ScaleShape): number[] {
  const found: number[] = []
  if (seed < shape.count && seedForOrdinal(seed, shape) === seed) found.push(seed)
  if (seed < shape.groupSize) found.push((shape.artworkCount - 1) * shape.groupSize + seed)
  const partialPage = seed - shape.partialSource * shape.groupSize
  if (partialPage >= 0 && partialPage < shape.groupSize * 0.8) found.push(shape.partialTarget * shape.groupSize + partialPage)
  return found
}
function candidateOrdinals(ordinal: number, shape: ScaleShape): { ids: number[]; postingVisits: number } {
  const seed = seedForOrdinal(ordinal, shape), group = Math.floor(seed / shape.domain), low = seed & (shape.domain - 1)
  const ids = new Set(occurrences(seed, shape))
  let postingVisits = ids.size * 40
  for (let region = 0; region < 10; region++) for (let band = 0; band < 4; band++) {
    const other = (1 - group) * shape.domain + (low ^ salt(region, band, shape.domain))
    const values = occurrences(other, shape)
    postingVisits += values.length
    for (const value of values) ids.add(value)
  }
  return { ids: [...ids].sort((a, b) => a - b), postingVisits }
}
const bitCounts = Uint8Array.from({ length: 65536 }, (_, number) => {
  let count = 0
  for (let value = number; value; value &= value - 1) count++
  return count
})
/** Independent numeric comparison for this fixture's single original view.
 * It does not call the production index, comparator, or assignment function. */
function matches(left: Uint16Array, right: Uint16Array): boolean {
  let global = 0, agreeing = 0
  for (let region = 0; region < 10; region++) {
    let distance = 0
    for (let band = 0; band < 4; band++) distance += bitCounts[left[region * 4 + band]! ^ right[region * 4 + band]!]!
    if (!region) global = distance
    else if (distance <= 10) agreeing++
  }
  return global <= 12 || global <= 28 && agreeing >= 7
}
export function scaleOracle(identity: ScaleIdentity): ScaleOracle {
  const { shape, imageIds, artworkIds } = identity
  if (imageIds.length !== shape.count || artworkIds.length !== shape.artworkCount) throw new Error('Incomplete oracle identity')
  const candidates = new Map<string, { left: number; right: number; edges: Array<[number, number]> }>()
  let comparisons = 0, candidateSlots = 0, maxCandidates = 0, maxPostingVisits = 0
  for (let ordinal = 0; ordinal < shape.count; ordinal++) {
    const query = candidateOrdinals(ordinal, shape), left = Math.floor(ordinal / shape.groupSize)
    candidateSlots += query.ids.length
    maxCandidates = Math.max(maxCandidates, query.ids.length); maxPostingVisits = Math.max(maxPostingVisits, query.postingVisits)
    const feature = segments(seedForOrdinal(ordinal, shape), shape)
    for (const other of query.ids) {
      const right = Math.floor(other / shape.groupSize)
      if (left >= right) continue
      comparisons++
      if (!matches(feature, segments(seedForOrdinal(other, shape), shape))) continue
      const key = `${left}:${right}`, candidate = candidates.get(key) ?? { left: artworkIds[left]!, right: artworkIds[right]!, edges: [] }
      candidate.edges.push([imageIds[ordinal]!, imageIds[other]!]); candidates.set(key, candidate)
    }
  }
  const ordered = [...candidates.values()].sort((a, b) => a.left - b.left || a.right - b.right)
  const pairs: ScalePair[] = []
  for (const candidate of ordered) {
    const leftOrdinal = artworkIds.indexOf(candidate.left) * shape.groupSize, rightOrdinal = artworkIds.indexOf(candidate.right) * shape.groupSize
    const outgoing = new Map<number, number[]>(), incoming = new Map<number, number>()
    for (const [left, right] of candidate.edges) { const values = outgoing.get(left) ?? []; values.push(right); outgoing.set(left, values); incoming.set(right, (incoming.get(right) ?? 0) + 1) }
    const paired = new Map<number, number>(), used = new Set<number>()
    for (const [left, values] of outgoing) if (values.length === 1 && incoming.get(values[0]!) === 1) { paired.set(left, values[0]!); used.add(values[0]!) }
    if (paired.size < shape.groupSize * 0.8) continue
    const pages: ScalePair['pages'] = []
    for (let index = 0; index < shape.groupSize; index++) {
      const left = imageIds[leftOrdinal + index]!, right = paired.get(left) ?? null
      pages.push([right === null ? 'UNMATCHED' : 'SIMILAR', left, right])
    }
    for (let index = 0; index < shape.groupSize; index++) { const right = imageIds[rightOrdinal + index]!; if (!used.has(right)) pages.push(['UNMATCHED', null, right]) }
    pairs.push({ left: candidate.left, right: candidate.right, pages })
  }
  const output = { comparisons, candidateSlots, candidates: ordered, pairs, postings: shape.count * 40, maxCandidates, maxPostingVisits }
  return { ...output, digest: digest(output) }
}
