import z from 'zod'

/**
 * 搜索建议请求体
 */
export const searchSuggestionsSchema = z.object({
  q: z.string(),
  mode: z.enum(['normal', 'tag']).optional().default('normal'),
  limit: z.number().min(1).max(10).optional().default(8)
})

export type SearchSuggestionsSchema = z.infer<typeof searchSuggestionsSchema>

export const SearchSuggestionSchema = z.object({
  type: z.enum(['artwork', 'artist', 'tag']),
  value: z.string(),
  label: z.string(),
  metadata: z
    .object({
      id: z.number().optional(),
      artistName: z.string().optional(),
      imageCount: z.number().optional(),
      artworkCount: z.number().optional()
    })
    .optional()
})

export const SearchSuggestionsResponseSchema = z.object({
  suggestions: z.array(SearchSuggestionSchema)
})

export type SearchSuggestion = z.infer<typeof SearchSuggestionSchema>
export type SearchSuggestionsResponse = z.infer<typeof SearchSuggestionsResponseSchema>
