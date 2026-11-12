import { httpBatchLink, httpLink, splitLink } from '@trpc/client'
import type { AppRouter } from '@/server'

const independentQueries = new Set([
  'archive.listTasks',
  'job.backgroundDashboard',
  'archiveInbox.summary',
  'archiveSearch.catalogCounts'
])

export function createTRPCTransport(url: string, fetchImplementation?: typeof fetch) {
  const options = { url, fetch: fetchImplementation }
  return splitLink<AppRouter>({
    // Lists and aggregates finish independently, including the first visit without cached data.
    condition: (op) => independentQueries.has(op.path),
    true: httpLink(options),
    false: httpBatchLink(options)
  })
}
