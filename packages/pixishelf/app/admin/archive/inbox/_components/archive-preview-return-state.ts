import { z } from 'zod'
import { sourceListFiltersSchema, discoveryFilterDraftSchema } from './archive-discovery-filter-state'

const stateSchema = z.object({
  savedAt: z.number(),
  sourceFilter: z.string(),
  selectedSourceId: z.string().nullable(),
  resultFeed: z.enum(['ACTIONABLE', 'PROCESSING', 'ARCHIVED', 'ATTENTION', 'ALL']),
  unboundOnly: z.boolean(),
  // Accepted for old snapshots only; display preferences belong to localStorage.
  resultView: z.enum(['list', 'preview', 'cards']).optional(),
  sourceFilters: sourceListFiltersSchema.optional(),
  sourceListScroll: z.number().nonnegative().optional(),
  contentFilters: discoveryFilterDraftSchema.optional(),
  positions: z
    .array(
      z.tuple([
        z.string(),
        z.object({
          loadedCount: z.number().int().nonnegative().optional(),
          anchorId: z.string().nullable(),
          anchorOffset: z.number(),
          scrollTop: z.number(),
          windowScrollY: z.number()
        })
      ])
    )
    .max(100)
})

export type ArchivePreviewReturnState = z.infer<typeof stateSchema>
const storageKey = (userId: string, route: string) => `archive-preview-return:${userId}:${route}`

export function readArchivePreviewReturnState(userId: string, route: string): ArchivePreviewReturnState | null {
  try {
    const key = storageKey(userId, route)
    const raw = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    const value = stateSchema.safeParse(raw ? JSON.parse(raw) : null)
    return value.success && Date.now() - value.data.savedAt < 30 * 60_000 ? value.data : null
  } catch {
    return null
  }
}

export function saveArchivePreviewReturnState(userId: string, route: string, state: ArchivePreviewReturnState) {
  try {
    sessionStorage.setItem(storageKey(userId, route), JSON.stringify(stateSchema.parse(state)))
  } catch {
    /* Storage is optional. */
  }
}
