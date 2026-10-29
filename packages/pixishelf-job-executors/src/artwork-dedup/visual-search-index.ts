import { validVisualViews } from './visual-matching.ts'
import type { VisualView } from './visual-experiment.ts'

export const VISUAL_SEARCH_VERSION = 'bktree-global12-region7of9-10-global28-v2'
export const VISUAL_SEARCH_MEMORY = 128 * 1024 * 1024
export interface SearchPage { imageId: number; artworkId: number; views: VisualView[]; reused: boolean }
export interface SearchCursor { queryAfter: number; queryImageId: number; candidateAfter: number; queryCompleted: number }
export interface SearchBatch { cursor: SearchCursor; complete: boolean; comparisons: number; compareMs: number; replayedQueries: number | null; candidates: number; nodeVisits: number; globalHits: number; localHits: number; artworkIds: number[]; edges: Array<[number, number, number, number]>; budgetWaiting: boolean }
const popcount = (x: number) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24 }

/** Equal hashes share a sibling chain, avoiding quadratic insertion in dense buckets. */
class HashTree {
  readonly child: Int32Array; readonly sibling: Int32Array; readonly equal: Int32Array; readonly distance: Uint8Array
  root = -1
  constructor(size: number, private readonly metric: (a: number, b: number) => number) {
    this.child = new Int32Array(size).fill(-1); this.sibling = new Int32Array(size).fill(-1)
    this.equal = new Int32Array(size).fill(-1); this.distance = new Uint8Array(size)
  }
  add(id: number) {
    if (this.root === -1) { this.root = id; return }
    let node = this.root
    for (;;) {
      const d = this.metric(id, node)
      if (!d) { this.equal[id] = this.equal[node]!; this.equal[node] = id; return }
      let next = this.child[node]!
      while (next !== -1 && this.distance[next] !== d) next = this.sibling[next]!
      if (next !== -1) { node = next; continue }
      this.distance[id] = d; this.sibling[id] = this.child[node]!; this.child[node] = id; return
    }
  }
  query(id: number, radius: number, accept: (view: number) => void): number {
    const stack = this.root === -1 ? [] : [this.root]
    let visits = 0
    while (stack.length) {
      const node = stack.pop()!, d = this.metric(id, node); visits++
      if (d <= radius) for (let equal = node; equal !== -1; equal = this.equal[equal]!) { if (equal !== node) visits++; accept(equal) }
      for (let child = this.child[node]!; child !== -1; child = this.sibling[child]!)
        if (this.distance[child]! >= d - radius && this.distance[child]! <= d + radius) stack.push(child)
    }
    return visits
  }
}

/** Validate at the input boundary; keep numeric hashes packed for all queries. */
export class VisualSearchIndex {
  private readonly hashes: Uint32Array
  private readonly information: Uint16Array
  private readonly aspect: Float64Array
  private readonly original: Uint8Array
  private readonly pageOfView: Uint32Array
  private readonly starts: Uint32Array
  private readonly trees: HashTree[]
  readonly pages: Array<Omit<SearchPage, 'views'>>
  readonly bytes: number
  private active: { imageId: number; ids: number[] } | undefined
  constructor(pages: SearchPage[], memoryLimit = VISUAL_SEARCH_MEMORY) {
    const views = pages.reduce((n, p) => n + p.views.length, 0)
    this.bytes = views * (80 + 2 + 8 + 1 + 4 + 130) + pages.length * 256 + views * 24
    if (this.bytes > memoryLimit) throw new Error('VISUAL_INDEX_MEMORY_BUDGET')
    this.hashes = new Uint32Array(views * 20); this.information = new Uint16Array(views)
    this.aspect = new Float64Array(views); this.original = new Uint8Array(views)
    this.pageOfView = new Uint32Array(views); this.starts = new Uint32Array(pages.length + 1)
    this.pages = pages.map(({ views: _, ...page }) => page)
    let viewId = 0
    for (let pageId = 0; pageId < pages.length; pageId++) {
      const page = pages[pageId]!
      if (!validVisualViews(page.views)) throw new Error('INVALID_VISUAL_FEATURES')
      this.starts[pageId] = viewId
      for (const view of page.views) {
        this.pageOfView[viewId] = pageId; this.aspect[viewId] = Math.log(view.feature.width / view.feature.height)
        this.original[viewId] = Number(view.name === 'original')
        for (let r = 0; r < 10; r++) {
          const h = view.feature.hashes[r]!
          this.hashes[viewId * 20 + r * 2] = parseInt(h.slice(0, 8), 16)
          this.hashes[viewId * 20 + r * 2 + 1] = parseInt(h.slice(8), 16)
          if (view.feature.information[r]! >= 8) this.information[viewId] = this.information[viewId]! | (1 << r)
        }
        viewId++
      }
    }
    this.starts[pages.length] = views
    this.trees = Array.from({ length: 10 }, (_, r) => new HashTree(views, (a, b) => this.distance(a, b, r)))
    for (let v = 0; v < views; v++) if (this.information[v]! & 1)
      for (let r = 0; r < 10; r++) if (this.information[v]! & (1 << r)) this.trees[r]!.add(v)
  }
  private distance(a: number, b: number, region: number) {
    const x = a * 20 + region * 2, y = b * 20 + region * 2
    return popcount(this.hashes[x]! ^ this.hashes[y]!) + popcount(this.hashes[x + 1]! ^ this.hashes[y + 1]!)
  }
  private eligible(a: number, b: number) { return (this.information[a]! & this.information[b]! & 1) !== 0 && Math.abs(this.aspect[a]! - this.aspect[b]!) <= 0.08 }
  private agrees(a: number, b: number) {
    let count = 0
    for (let r = 1; r < 10; r++) if ((this.information[a]! & this.information[b]! & (1 << r)) && this.distance(a, b, r) <= 10) count++
    return count
  }
  private matched(a: number, b: number) {
    for (let x = this.starts[a]!; x < this.starts[a + 1]!; x++)
      for (let y = this.starts[b]!; y < this.starts[b + 1]!; y++) {
        if (!this.eligible(x, y)) continue
        const global = this.distance(x, y, 0), local = this.agrees(x, y)
        if ((global <= 12 || global <= 28 && local >= 7) && (this.original[x] && this.original[y] || local >= 1)) return true
      }
    return false
  }
  query(pageId: number) {
    const result = new Set<number>(); let nodeVisits = 0, globalHits = 0, localHits = 0
    const page = this.pages[pageId]!
    const allowed = (v: number) => { const other = this.pages[this.pageOfView[v]!]!; return page.artworkId < other.artworkId && !(page.reused && other.reused) }
    for (let v = this.starts[pageId]!; v < this.starts[pageId + 1]!; v++) {
      if (!(this.information[v]! & 1)) continue
      nodeVisits += this.trees[0]!.query(v, 12, b => {
        if (allowed(b) && this.eligible(v, b)) { result.add(this.pageOfView[b]!); globalHits++ }
      })
      // Reset per left view: separate view pairs cannot pool their local votes.
      const votes = new Uint8Array(this.pageOfView.length)
      for (let r = 1; r < 10; r++) if (this.information[v]! & (1 << r))
        nodeVisits += this.trees[r]!.query(v, 10, b => {
          if (allowed(b) && this.eligible(v, b)) votes[b] = votes[b]! + 1
        })
      for (let b = 0; b < votes.length; b++) if (votes[b]! >= 7 && this.distance(v, b, 0) <= 28) {
        result.add(this.pageOfView[b]!); localHits++
      }
    }
    return { ids: [...result].sort((a, b) => this.pages[a]!.imageId - this.pages[b]!.imageId), nodeVisits, globalHits, localHits }
  }
  batch(input: SearchCursor, comparisonBudget: number, maxQueries = 128, maxComparisons = 2000, milliseconds = 1000): SearchBatch {
    const started = performance.now(), cursor = { ...input }, edges: SearchBatch['edges'] = [], artworks = new Set<number>()
    let comparisons = 0, compareMs = 0, candidates = 0, nodeVisits = 0, globalHits = 0, localHits = 0, completed = 0
    let replayedQueries: number | null = null
    let pageId = this.pages.findIndex(p => input.queryImageId ? p.imageId === input.queryImageId : p.imageId > input.queryAfter)
    if (pageId === -1) return { cursor, complete: true, comparisons, compareMs, replayedQueries, candidates, nodeVisits, globalHits, localHits, artworkIds: [], edges, budgetWaiting: false }
    for (; pageId < this.pages.length; pageId++) {
      const page = this.pages[pageId]!
      if (this.active?.imageId !== page.imageId) {
        if (page.imageId === input.queryImageId) replayedQueries = 1
        const query = this.query(pageId); this.active = { imageId: page.imageId, ids: query.ids }
        nodeVisits += query.nodeVisits; globalHits += query.globalHits; localHits += query.localHits
      }
      artworks.add(page.artworkId); cursor.queryImageId = page.imageId
      for (const otherId of this.active.ids) {
        const other = this.pages[otherId]!
        if (other.imageId <= cursor.candidateAfter) continue
        if (comparisons >= comparisonBudget || comparisons >= maxComparisons || (comparisons > 0 && performance.now() - started >= milliseconds))
          return { cursor, complete: false, comparisons, compareMs, replayedQueries, candidates, nodeVisits, globalHits, localHits, artworkIds: [...artworks], edges, budgetWaiting: comparisons >= comparisonBudget }
        comparisons++; candidates++; artworks.add(other.artworkId)
        const compareStarted = performance.now()
        const matched = this.matched(pageId, otherId)
        compareMs += performance.now() - compareStarted
        if (matched) edges.push([page.artworkId, other.artworkId, page.imageId, other.imageId])
        cursor.candidateAfter = other.imageId
      }
      cursor.queryAfter = page.imageId; cursor.queryImageId = 0; cursor.candidateAfter = 0; cursor.queryCompleted++; completed++
      if (completed >= maxQueries || performance.now() - started >= milliseconds) break
    }
    return { cursor, complete: cursor.queryCompleted === this.pages.length, comparisons, compareMs, replayedQueries, candidates, nodeVisits, globalHits, localHits, artworkIds: [...artworks], edges, budgetWaiting: false }
  }
}
