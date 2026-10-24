import { archiveTitleQuerySchema, archiveTitleSearchTerm } from '@pixishelf/job-contracts'

export function archiveTitleSearchHref(input: unknown): string | null {
  const parsed = archiveTitleQuerySchema.safeParse(input)
  if (!parsed.success) return null
  const url = new URL('https://e-hentai.org/')
  url.searchParams.set('f_search', archiveTitleSearchTerm(parsed.data))
  return url.toString()
}

export function archiveDiscoverySourceHref(sourceId: string): string {
  return `/admin/archive/inbox?${new URLSearchParams({ tab: 'uploaders', sourceId })}`
}
