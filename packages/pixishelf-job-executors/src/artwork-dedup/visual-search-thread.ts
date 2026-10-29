import { parentPort } from 'node:worker_threads'
import { VisualSearchIndex, VISUAL_SEARCH_MEMORY, type SearchPage, type SearchCursor } from './visual-search-index.ts'
let pages: SearchPage[] = []
let bytes = 0
let index: VisualSearchIndex | undefined
parentPort!.on('message', (message: { id: number } & ({ kind: 'LOAD'; pages: SearchPage[] } | { kind: 'BUILD' } | { kind: 'BATCH'; cursor: SearchCursor; budget: number })) => {
  try {
    let value: unknown
    if (message.kind === 'LOAD') {
      bytes += message.pages.reduce((n, p) => n + p.views.length * 2048 + 256, 0)
      if (bytes > VISUAL_SEARCH_MEMORY) throw new Error('VISUAL_INDEX_MEMORY_BUDGET')
      pages.push(...message.pages)
    } else if (message.kind === 'BUILD') {
      const start = performance.now()
      index = new VisualSearchIndex(pages, VISUAL_SEARCH_MEMORY - bytes)
      pages = []
      value = { bytes: index.bytes + bytes, memoryPeakBytes: process.memoryUsage().rss, indexMs: performance.now() - start }
    } else value = index!.batch(message.cursor, message.budget)
    parentPort!.postMessage({ id: message.id, value })
  } catch (error) { parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }) }
})
