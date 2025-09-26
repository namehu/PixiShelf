import { useInfiniteQuery } from '@tanstack/react-query'
import { apiJson } from '@/lib/api'

// 图片数据类型
export interface ImageItem {
  id: number
  title: string
  description?: string
  imageUrl: string
  author: {
    id: number
    name: string
    username?: string
  } | null
  createdAt: string
  tags: string[]
}

// API响应类型
interface RandomImagesResponse {
  items: ImageItem[]
  total: number
  page: number
  pageSize: number
  nextPage: number | null
}

/**
 * 无限滚动图片数据Hook
 * 使用TanStack Query的useInfiniteQuery实现无限滚动数据获取和缓存
 */
export function useInfiniteImages(pageSize: number = 10) {
  return useInfiniteQuery({
    queryKey: ['images', 'random', 'infinite'],
    queryFn: async ({ pageParam = 1 }): Promise<RandomImagesResponse> => {
      return apiJson<RandomImagesResponse>(`/api/images/random?page=${pageParam}&pageSize=${pageSize}`)
    },
    // getNextPageParam 告诉 React Query 如何找到下一页的页码
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1, // 初始页码
    // 缓存配置
    staleTime: 5 * 60 * 1000, // 5分钟内数据被认为是新鲜的
    gcTime: 10 * 60 * 1000, // 10分钟后清理缓存
    // 重试配置
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}