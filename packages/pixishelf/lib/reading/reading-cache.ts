import type { QueryClient } from '@tanstack/react-query'
import { compareReadingVersion, isArtworkReadingComplete, type ReadingSummaryDto, type ReadingReportResult, type ReadingContextDto } from '@pixishelf/db/reading-contract'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function belongsToAccount(queryKey: readonly unknown[], ownerUserId: string): boolean {
  const [namespace, operation, account] = queryKey
  if (namespace === 'reading' && (operation === 'summaries' || operation === 'history' || operation === 'continueReading')) {
    return account === ownerUserId
  }
  if (namespace === 'artwork' && (operation === 'cardList' || operation === 'viewerFeed')) {
    return account === ownerUserId
  }
  // tRPC queryOptions keys contain a procedure path and its input in separate slots.
  if (!Array.isArray(namespace) || !isRecord(operation) || !isRecord(operation.input)) return false
  const [router, procedure] = namespace
  const readingProcedure = router === 'reading' &&
    (procedure === 'context' || procedure === 'summaries' || procedure === 'history' || procedure === 'continueReading')
  const artworkProcedure = router === 'artwork' &&
    (procedure === 'list' || procedure === 'cardList' || procedure === 'viewerFeed' || procedure === 'reader')
  return (readingProcedure || artworkProcedure) && operation.input.expectedUserId === ownerUserId
}

function isContinueReadingQuery(queryKey: readonly unknown[]): boolean {
  const [namespace, operation] = queryKey
  return namespace === 'reading' && operation === 'continueReading' ||
    Array.isArray(namespace) && namespace[0] === 'reading' && namespace[1] === 'continueReading'
}

function removeFinishedContinueReading(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.items)) return value
  const items = value.items.filter((item: unknown) => {
    if (!isRecord(item) || !isSummary(item.reading)) return true
    const summary = item.reading
    return summary.viewCount > 0 && summary.lastViewedAt !== null &&
      summary.totalCount > 0 && !isArtworkReadingComplete(summary.seenCount, summary.totalCount)
  })
  return items.length === value.items.length ? value : { ...value, items }
}

type Snapshot = { summary: ReadingSummaryDto; progress?: ReadingReportResult; context?: ReadingContextDto }
const snapshots = new WeakMap<QueryClient, Map<string, Map<number, Snapshot>>>()

function accountSnapshots(client: QueryClient, owner: string) {
  let accounts = snapshots.get(client)
  if (!accounts) snapshots.set(client, accounts = new Map())
  let records = accounts.get(owner)
  if (!records) accounts.set(owner, records = new Map())
  return records
}

function isSummary(value: unknown): value is ReadingSummaryDto {
  return isRecord(value) && typeof value.artworkId === 'number' && typeof value.viewCount === 'number' &&
    typeof value.stateVersion === 'number' && typeof value.mediaRevision === 'number'
}

const childKeys = new Set(['summary', 'reading', 'readingSummary', 'summaries', 'items', 'pages', 'data'])

/** Preserve confirmed versions even when an older in-flight query finishes after a mutation. */
export function reconcileReadingCache(client: QueryClient, owner: string) {
  const records = accountSnapshots(client, owner)
  const queries = client.getQueryCache().getAll().filter((query) => belongsToAccount(query.queryKey, owner))
  const collect = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(collect); return }
    if (!isRecord(value)) return
    if (isSummary(value)) {
      const prior = records.get(value.artworkId)
      if (!prior || compareReadingVersion(value, prior.summary) > 0) {
        records.set(value.artworkId, { summary: value, progress: prior?.progress, context: prior?.context })
      }
      return
    }
    if (isSummary(value.summary) && Array.isArray(value.seenMediaIds)) {
      const summary = value.summary
      const prior = records.get(summary.artworkId)
      if (!prior || compareReadingVersion(summary, prior.summary) >= 0) {
        records.set(summary.artworkId, { summary, context: Array.isArray(value.media) ? value as unknown as ReadingContextDto : prior?.context, progress: {
          summary, mediaRevision: summary.mediaRevision, seenMediaIds: value.seenMediaIds as number[]
        } })
      }
    }
    for (const [key, item] of Object.entries(value)) if (childKeys.has(key)) collect(item)
  }
  queries.forEach((query) => collect(query.state.data))
  const patch = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const next = value.map(patch)
      return next.some((item, index) => item !== value[index]) ? next : value
    }
    if (!isRecord(value)) return value
    if (isSummary(value)) {
      const latest = records.get(value.artworkId)?.summary
      return latest && compareReadingVersion(latest, value) > 0 ? latest : value
    }
    // A context needs an atomic ID-set + summary snapshot, never a summary-only patch.
    if (isSummary(value.summary) && Array.isArray(value.seenMediaIds)) {
      const record = records.get(value.summary.artworkId)
      if (record?.context && record.context.mediaRevision > (value.mediaRevision as number)) return record.context
      const latest = record?.progress
      if (!latest || latest.mediaRevision !== value.mediaRevision || compareReadingVersion(latest.summary, value.summary) <= 0) return value
      return { ...value, summary: latest.summary, seenMediaIds: latest.seenMediaIds }
    }
    let next: Record<string, unknown> | undefined
    for (const [key, item] of Object.entries(value)) {
      if (!childKeys.has(key)) continue
      const result = patch(item)
      if (result !== item) { next ??= { ...value }; next[key] = result }
    }
    return next ?? value
  }
  for (const query of queries) {
    let next = patch(query.state.data)
    if (isContinueReadingQuery(query.queryKey)) next = removeFinishedContinueReading(next)
    const [namespace, operation, , ids] = query.queryKey
    if (namespace === 'reading' && operation === 'summaries' && typeof ids === 'string' && Array.isArray(next)) {
      const present = new Set(next.filter(isSummary).map((summary) => summary.artworkId))
      const additions = ids.split(',').map(Number).filter((id) => !present.has(id)).flatMap((id) => {
        const record = records.get(id)
        return record ? [record.summary] : []
      })
      if (additions.length) next = [...next, ...additions]
    }
    if (next !== query.state.data) client.setQueryData(query.queryKey, next)
  }
}

/** Preserve loaded list order; the home continuation shelf drops finished items. */
export function patchReadingSummaryInCache(
  client: QueryClient, summary: ReadingSummaryDto, owner: string, progress?: ReadingReportResult
) {
  const records = accountSnapshots(client, owner)
  const prior = records.get(summary.artworkId)
  if (!prior || compareReadingVersion(summary, prior.summary) >= 0) {
    records.set(summary.artworkId, { summary, progress: progress ?? prior?.progress, context: prior?.context })
  }
  reconcileReadingCache(client, owner)
  // Refill on the next visit; an old account's response must not refetch using a new session.
  void client.invalidateQueries({
    predicate: (query) => belongsToAccount(query.queryKey, owner) && isContinueReadingQuery(query.queryKey),
    refetchType: 'none'
  })
}
