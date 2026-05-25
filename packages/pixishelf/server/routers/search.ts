import { searchSuggestionsSchema } from '@/schemas/search.dto'
import { authProcedure, router } from '@/server/trpc'
import { getSearchSuggestions } from '@/services/search-service'

/**
 * 搜索路由
 */
export const searchRouter = router({
  /**
   * 获取搜索建议
   */
  suggestions: authProcedure.input(searchSuggestionsSchema).query(async ({ input }) => {
    return await getSearchSuggestions(input)
  })
})
