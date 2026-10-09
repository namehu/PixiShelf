import { z } from 'zod'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server'
import type { ArchiveDiscoveryFilters } from '@/lib/archive-discovery-filters'

export const sourceListFiltersSchema = z.object({
  search: z.string().default(''),
  kind: z.enum(['ALL', 'UPLOADER', 'TITLE_QUERY']).default('ALL'),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  actionable: z.boolean().default(false),
  attention: z.boolean().default(false)
})
export type SourceListFilters = z.infer<typeof sourceListFiltersSchema>
export const DEFAULT_SOURCE_FILTERS = sourceListFiltersSchema.parse({})
export const discoveryFilterDraftSchema = z.object({
  search: z.string().max(200).default(''),
  categories: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  dateFrom: z.string().default(''),
  dateTo: z.string().default(''),
  unknownDate: z.boolean().default(false),
  unboundOnly: z.boolean().default(false)
})
export type DiscoveryFilterDraft = z.infer<typeof discoveryFilterDraftSchema>
export const DEFAULT_DISCOVERY_FILTERS = discoveryFilterDraftSchema.parse({})

export function discoveryQueryFilters(draft: DiscoveryFilterDraft): ArchiveDiscoveryFilters {
  const localDate = (value: string, nextDay = false) => {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year!, month! - 1, day! + (nextDay ? 1 : 0))
  }
  return {
    search: draft.search.trim(),
    categories: draft.categories,
    languages: draft.languages,
    unknownDate: draft.unknownDate,
    postedFrom: !draft.unknownDate && draft.dateFrom ? localDate(draft.dateFrom) : undefined,
    postedBefore: !draft.unknownDate && draft.dateTo ? localDate(draft.dateTo, true) : undefined
  }
}

type Source = inferRouterOutputs<AppRouter>['archiveSearch']['listSources'][number]
export function filterDiscoverySources(sources: Source[], filters: SourceListFilters) {
  const search = filters.search.trim().toLocaleLowerCase()
  return sources.filter(
    (source) =>
      (filters.kind === 'ALL' || (source.sourceKind ?? 'UPLOADER') === filters.kind) &&
      (filters.status === 'ALL' || source.status === filters.status) &&
      (!filters.actionable || (source.catalogCounts?.actionable ?? 0) > 0) &&
      (!filters.attention || (source.catalogCounts?.attention ?? 0) > 0) &&
      (!search ||
        [
          source.displayName,
          source.identityValue,
          source.uploaderUid,
          source.titleQuery?.keyword,
          source.titleQuery?.uploaderName,
          source.titleQuery?.uploaderUid
        ].some((value) => value?.toLocaleLowerCase().includes(search)))
  )
}
