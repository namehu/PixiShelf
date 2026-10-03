import { httpBatchLink, httpLink, splitLink } from '@trpc/client'
import type { AppRouter } from '@/server'

export function createTRPCTransport(url: string, fetchImplementation?: typeof fetch) {
  const options = { url, fetch: fetchImplementation }
  return splitLink<AppRouter>({
    // Slow aggregates must not hold metadata and catalog pages in the same HTTP batch.
    condition: (op) => op.path === 'archiveSearch.catalogCounts',
    true: httpLink(options),
    false: httpBatchLink(options)
  })
}
