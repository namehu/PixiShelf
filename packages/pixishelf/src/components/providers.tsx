'use client'

import React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/components'
import { createQueryClient } from '@/lib/query-client'

// 创建QueryClient实例
const queryClient = createQueryClient()

export interface ProvidersProps {
  children: React.ReactNode
}

/**
 * 应用程序的所有 Context Providers
 */
export function Providers({ children }: ProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  )
}