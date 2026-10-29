import { describe, expect, it } from 'vitest'
import { VisualSearchIndex, type SearchPage, type SearchCursor } from '../visual-search-index.ts'
import { compareProductionVisual } from '../visual-matching.ts'
const hex = (value: bigint) => value.toString(16).padStart(16, '0')
const feature = (hashes: string[], name = 'original') => ({ name, feature: { width: 96, height: 96, information: Array<number>(10).fill(30), hashes } })
const page = (imageId: number, hashes: string[], artworkId = imageId): SearchPage => ({ imageId, artworkId, views: [feature(hashes)], reused: false })
const initial: SearchCursor = { queryAfter: 0, queryImageId: 0, candidateAfter: 0, queryCompleted: 0 }
const zero = Array<string>(10).fill('0000000000000000')

describe('visual search v2', () => {
  it('retrieves the full global radius including cases missed by exact 16-bit bands', () => {
    const b = [...zero]; b[0] = '0007000700070007'
    const pages = [page(1, zero), page(2, b)]
    expect(new VisualSearchIndex(pages).batch(initial, 100).edges).toEqual([[1, 2, 1, 2]])
  })
  it('uses seven informative same-region votes with global distance at most28', () => {
    const b = [hex((1n << 28n) - 1n), ...zero.slice(1, 8), 'ffffffffffffffff', 'ffffffffffffffff']
    const index = new VisualSearchIndex([page(1, zero), page(2, b)])
    expect(index.query(0).localHits).toBe(1)
    expect(index.batch(initial, 10).edges).toHaveLength(1)
    b[0] = hex((1n << 29n) - 1n)
    expect(new VisualSearchIndex([page(1, zero), page(2, b)]).query(0).ids).toEqual([])
  })
  it('never combines votes across target or source views', () => {
    const other = (matched: number[]) => feature([hex((1n << 20n) - 1n), ...Array.from({ length: 9 }, (_, i) => matched.includes(i) ? zero[0]! : 'ffffffffffffffff')])
    const right = { ...page(2, zero), views: [other([0, 1, 2, 3]), other([4, 5, 6, 7, 8])] }
    expect(new VisualSearchIndex([page(1, zero), right]).query(0).ids).toEqual([])
    const left = { ...page(1, zero), views: right.views }
    expect(new VisualSearchIndex([left, page(2, zero)]).query(0).ids).toEqual([])
  })
  it('preserves crop, aspect and information eligibility gates', () => {
    const a = page(1, zero), b = page(2, [zero[0]!, ...Array<string>(9).fill('ffffffffffffffff')])
    a.views[0]!.name = 'crop5'
    expect(new VisualSearchIndex([a, b]).batch(initial, 100).edges).toEqual([])
    b.views[0]!.feature.width = 192
    expect(new VisualSearchIndex([a, b]).query(0).ids).toEqual([])
    b.views[0]!.feature.width = 96; b.views[0]!.feature.information[0] = 7
    expect(new VisualSearchIndex([a, b]).query(0).ids).toEqual([])
  })
  it('excludes same artwork, reverse pairs and unchanged pairs before fine comparison', () => {
    const pages = [page(1, zero, 1), page(2, zero, 1), page(3, zero, 2), page(4, zero, 3)]
    pages[0]!.reused = true; pages[1]!.reused = true; pages[2]!.reused = true
    const result = new VisualSearchIndex(pages).batch(initial, 100)
    expect(result.comparisons).toBe(3)
    expect(result.edges).toEqual([[1, 3, 1, 4], [1, 3, 2, 4], [2, 3, 3, 4]])
  })
  it('matches a deterministic exhaustive production oracle including multiview candidates', () => {
    let seed = 127
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
    const hashes = () => Array.from({ length: 10 }, () => hex(BigInt(random()) << 32n | BigInt(random())))
    const pages: SearchPage[] = []
    for (let n = 0; n < 40; n++) {
      const h = hashes(); pages.push(page(n * 2 + 1, h))
      const near = h.map((v, r) => hex(BigInt(`0x${v}`) ^ ((1n << BigInt(r === 0 ? n % 30 : n % 12)) - 1n)))
      pages.push({ ...page(n * 2 + 2, near), views: [feature(near, n % 2 ? 'crop5' : 'original'), feature(hashes(), 'crop10')] })
    }
    const expected: number[][] = []
    for (const a of pages) for (const b of pages) if (a.artworkId < b.artworkId && compareProductionVisual(a.views, b.views).matched) expected.push([a.artworkId, b.artworkId, a.imageId, b.imageId])
    expect(new VisualSearchIndex(pages).batch(initial, 10000, 128, 10000, Infinity).edges).toEqual(expected)
  })
  it('resumes mid-query after worker restart without duplicated counts or edges', () => {
    const pages = Array.from({ length: 25 }, (_, i) => page(i + 1, zero))
    const expected = new VisualSearchIndex(pages).batch(initial, 10000, 128, 10000, Infinity)
    let cursor = initial, comparisons = 0
    const edges: number[][] = []
    for (let n = 0; n < 100; n++) {
      const batch = new VisualSearchIndex(pages).batch(cursor, 10000, 3, 7, Infinity)
      comparisons += batch.comparisons; edges.push(...batch.edges); cursor = batch.cursor
      if (batch.complete) break
    }
    expect(cursor.queryCompleted).toBe(pages.length)
    expect(comparisons).toBe(expected.comparisons); expect(edges).toEqual(expected.edges)
  })
  it('replays an uncommitted prefix and stops only at explicit comparison permission', () => {
    const index = new VisualSearchIndex(Array.from({ length: 8 }, (_, i) => page(i + 1, zero)))
    const a = index.batch(initial, 2), replay = index.batch(initial, 2)
    expect(replay.cursor).toEqual(a.cursor); expect(replay.edges).toEqual(a.edges)
    expect(a.compareMs).toBeGreaterThan(0); expect(a.replayedQueries).toBeNull()
    expect(new VisualSearchIndex(Array.from({ length: 8 }, (_, i) => page(i + 1, zero))).batch(a.cursor, 100).replayedQueries).toBe(1)
    expect(a.budgetWaiting).toBe(true); expect(a.cursor.queryCompleted).toBe(0)
    const next = index.batch(a.cursor, 100)
    expect(next.comparisons + a.comparisons).toBe(28)
  })
  it('measures a production-limit dense multiview query without truncation', () => {
    const pages = Array.from({ length: 10000 }, (_, i) => ({ ...page(i + 1, zero), views: Array.from({ length: 4 }, (_, j) => feature(zero, j ? 'crop5' : 'original')) }))
    const index = new VisualSearchIndex(pages), start = performance.now(), result = index.query(0)
    expect(result.ids).toHaveLength(9999)
    console.info('VISUAL_V2_DENSE_QUERY', JSON.stringify({ images: pages.length, views: 40000, nodeVisits: result.nodeVisits, queryMs: performance.now() - start, packedEstimateBytes: index.bytes, processRssBytes: process.memoryUsage().rss }))
  })
  it('reports memory budget failure instead of silently truncating candidates', () => {
    expect(() => new VisualSearchIndex([page(1, zero)], 1)).toThrow('VISUAL_INDEX_MEMORY_BUDGET')
    expect(() => new VisualSearchIndex([page(1, ['bad'])])).toThrow('INVALID_VISUAL_FEATURES')
  })
})
