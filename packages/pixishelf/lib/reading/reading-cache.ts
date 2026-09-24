import type { QueryClient } from '@tanstack/react-query'
import type { ReadingSummaryDto } from '@pixishelf/db/reading-contract'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function belongsToAccount(queryKey: readonly unknown[], ownerUserId: string): boolean {
  const [namespace, operation, account] = queryKey
  if (namespace === 'reading' && (operation === 'summaries' || operation === 'history')) {
    return account === ownerUserId
  }
  if (namespace === 'artwork' && (operation === 'cardList' || operation === 'viewerFeed')) {
    return account === ownerUserId
  }
  // tRPC queryOptions keys contain a procedure path and its input in separate slots.
  if (!Array.isArray(namespace) || !isRecord(operation) || !isRecord(operation.input)) return false
  const [router, procedure] = namespace
  const readingProcedure = router === 'reading' &&
    (procedure === 'context' || procedure === 'summaries' || procedure === 'history')
  const artworkProcedure = router === 'artwork' &&
    (procedure === 'list' || procedure === 'cardList' || procedure === 'viewerFeed')
  return (readingProcedure || artworkProcedure) && operation.input.expectedUserId === ownerUserId
}

/** Patch visible badges in place; filtered list membership and ordering stay stable until explicit refresh. */
export function patchReadingSummaryInCache(
  queryClient: QueryClient,
  summary: ReadingSummaryDto,
  ownerUserId: string
) {
  const patch = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      let changed = false
      const next = value.map((item) => {
        const patched = patch(item)
        changed ||= patched !== item
        return patched
      })
      return changed ? next : value
    }
    if (!value || typeof value !== 'object') return value
    const object = value as Record<string, unknown>
    let next: Record<string, unknown> | null = null
    if (object.artworkId === summary.artworkId &&
      typeof object.viewCount === 'number' && typeof object.seenCount === 'number') {
      return summary
    }
    for (const [key, item] of Object.entries(object)) {
      if (key !== 'summary' && key !== 'reading' && key !== 'readingSummary' &&
        key !== 'summaries' && key !== 'items' && key !== 'pages' && key !== 'data') continue
      const patched = patch(item)
      if (patched !== item) {
        next ??= { ...object }
        next[key] = patched
      }
    }
    return next ?? value
  }
  for (const query of queryClient.getQueryCache().getAll()) {
    if (!belongsToAccount(query.queryKey, ownerUserId)) continue
    if (query.state.data === undefined) continue
    queryClient.setQueryData(query.queryKey, (value: unknown) => patch(value))
  }
}
