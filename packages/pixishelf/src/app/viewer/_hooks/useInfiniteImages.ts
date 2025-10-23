import { useInfiniteQuery } from '@tanstack/react-query'
import { apiJson } from '@/lib/api'
import { RandomImagesResponse } from '@/types/images'

/**
 * 无限滚动图片数据Hook
 * 使用TanStack Query的useInfiniteQuery实现无限滚动数据获取和缓存
 *
 * @param pageSize 每页数据数量，默认为10
 * @param enableStateRecovery 是否启用状态恢复模式，启用后会延长缓存时间
 * @param maxImageCount 最大图片数量，默认为8
 */
export function useInfiniteImages(enableStateRecovery: boolean = true, maxImageCount: number = 8) {
  return useInfiniteQuery({
    queryKey: ['images', 'random', 'infinite', maxImageCount],
    queryFn: async ({ pageParam = 1 }): Promise<RandomImagesResponse> => {
      return apiJson<RandomImagesResponse>(`/api/images/random?page=${pageParam}&count=${maxImageCount}`)
    },
    // getNextPageParam 告诉 React Query 如何找到下一页的页码
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1, // 初始页码

    // 缓存配置 - 根据是否启用状态恢复调整缓存时间
    staleTime: enableStateRecovery
      ? 10 * 60 * 1000 // 状态恢复模式：10分钟内数据保持新鲜
      : 5 * 60 * 1000, // 普通模式：5分钟内数据保持新鲜
    gcTime: enableStateRecovery
      ? 15 * 60 * 1000 // 状态恢复模式：15分钟后清理缓存
      : 10 * 60 * 1000, // 普通模式：10分钟后清理缓存

    // 重试配置
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000)
  })
}
