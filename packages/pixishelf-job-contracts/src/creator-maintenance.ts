import { z } from 'zod'

const ids = z.array(z.number().int().positive()).min(1).max(10000)
export const creatorMaintenanceInputSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('BACKFILL'), artworkIds: ids.optional() }).strict(),
  z.object({ command: z.enum(['ADD', 'REMOVE']), artworkIds: ids, creatorIds: ids.max(200) }).strict(),
  z.object({ command: z.literal('SERIES'), artworkIds: ids, seriesId: z.number().int().positive() }).strict(),
  z
    .object({
      command: z.literal('REMAP'),
      mappingId: z.string().min(1).max(128),
      artistId: z.number().int().positive(),
      expectedVersion: z.number().int().positive()
    })
    .strict()
])
export type CreatorMaintenanceInput = z.infer<typeof creatorMaintenanceInputSchema>
