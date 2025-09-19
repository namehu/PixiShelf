import { QueryClient } from '@tanstack/react-query'

/**
 * 创建 QueryClient 实例
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5分钟
        retry: 1
      }
    }
  })
}