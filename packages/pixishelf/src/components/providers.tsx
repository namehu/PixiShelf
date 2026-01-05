'use client'

import React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/components/auth'
import { QueryClient } from '@tanstack/react-query'
import type { AuthMeResponseDTO } from '@/schemas/auth.dto'

// 创建QueryClient实例
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5分钟
      retry: 1
    }
  }
})

export interface ProvidersProps {
  children: React.ReactNode
  initialUser?: AuthMeResponseDTO | null
}

/**
 * 应用程序的所有 Context Providers
 */
export function Providers({ children, initialUser }: ProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
    </QueryClientProvider>
  )
}
