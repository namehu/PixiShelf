import { z } from 'zod'

export const seriesManagementChangesSchema = z.object({
  seriesId: z.number().int().positive(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  finalArtworkIds: z
    .array(z.number().int().positive())
    .refine((ids) => new Set(ids).size === ids.length, '作品 ID 不能重复'),
  explicitReorder: z.boolean()
})

export type SeriesManagementChanges = z.infer<typeof seriesManagementChangesSchema>
export type SeriesMembershipOrigin = 'SOURCE' | 'MANUAL' | 'LEGACY'
export interface SeriesArtworkRow {
  id: number
  title: string
  thumbnailUrl: string | null
  author: string
  mediaCount: number
  sortOrder: number
  provenance: SeriesMembershipOrigin
  orderOverridden: boolean
}
export interface RecoverableSeriesMember {
  artworkId: number
  sortOrder: number
  provenance: SeriesMembershipOrigin
}

// Keep this deterministic on the server and in the draft, including historical order gaps.
export function naturalSeriesOrder(
  ids: number[],
  stored: ReadonlyArray<{ artworkId: number; sortOrder: number }>,
  maxStoredSortOrder: number
) {
  const ranks = new Map(stored.map((row) => [row.artworkId, row.sortOrder]))
  let next = maxStoredSortOrder
  for (const id of ids) if (!ranks.has(id)) ranks.set(id, ++next)
  return [...ids].sort((a, b) => ranks.get(a)! - ranks.get(b)! || a - b)
}
