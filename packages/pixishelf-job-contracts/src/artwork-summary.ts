import { z } from 'zod'

export const ARTWORK_SUMMARY_ALGORITHM_VERSION = 1
export const ARTWORK_SUMMARY_CONFLICT = 'ARTWORK_SUMMARY_CONFLICT'
export const artworkSummaryPayloadSchema = z.object({
  artworkId: z.number().int().positive(),
  generationId: z.string().uuid(),
  sourceRevision: z.number().int().nonnegative(),
  force: z.boolean().optional()
}).strict()
export type ArtworkSummaryPayload = z.infer<typeof artworkSummaryPayloadSchema>

export const artworkSummaryGroupSchema = z.object({
  id: z.string(),
  mediaIds: z.array(z.number().int().positive()).min(1),
  representativeMediaId: z.number().int().positive(),
  startIndex: z.number().int().nonnegative(),
  endIndex: z.number().int().nonnegative()
})
export const artworkSummaryGroupsSchema = z.array(artworkSummaryGroupSchema)
export type ArtworkSummaryGroup = z.infer<typeof artworkSummaryGroupSchema>

/** Compact, versioned spatial features; no original pixels or file paths go to the browser. */
export const summaryFeatureSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{16}$/),
  colors: z.array(z.number().min(0).max(255)).length(192),
  aspect: z.number().positive()
})
export type SummaryFeature = z.infer<typeof summaryFeatureSchema>

export function similarSummaryFeatures(a: SummaryFeature, b: SummaryFeature): boolean {
  if (Math.abs(a.aspect / b.aspect - 1) > 0.02) return false
  let distance = 0
  for (let i = 0; i < 16; i++) {
    let bits = Number.parseInt(a.hash[i]!, 16) ^ Number.parseInt(b.hash[i]!, 16)
    while (bits) { distance++; bits &= bits - 1 }
  }
  if (distance > 4) return false
  let total = 0
  for (let i = 0; i < 192; i += 3) {
    const difference = (Math.abs(a.colors[i]! - b.colors[i]!) +
      Math.abs(a.colors[i + 1]! - b.colors[i + 1]!) + Math.abs(a.colors[i + 2]! - b.colors[i + 2]!)) / 3
    // A local change must not disappear into a large unchanged background.
    if (difference > 28) return false
    total += difference
  }
  return total / 64 <= 8
}

export function groupSummaryMedia(items: readonly { mediaId: number; feature: SummaryFeature | null }[]): ArtworkSummaryGroup[] {
  const groups: ArtworkSummaryGroup[] = []
  let anchor: SummaryFeature | null = null
  let previous: SummaryFeature | null = null
  items.forEach((item, index) => {
    const group = groups.at(-1)
    if (group && item.feature && anchor && previous &&
      similarSummaryFeatures(item.feature, anchor) && similarSummaryFeatures(item.feature, previous)) {
      group.mediaIds.push(item.mediaId)
      group.endIndex = index
    } else {
      groups.push({ id: String(item.mediaId), mediaIds: [item.mediaId], representativeMediaId: item.mediaId,
        startIndex: index, endIndex: index })
      anchor = item.feature
    }
    previous = item.feature
  })
  return groups
}
