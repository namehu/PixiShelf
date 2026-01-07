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
