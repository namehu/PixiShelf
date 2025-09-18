'use client'

import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/toast'
import { NotificationProvider } from '@/components/ui/notification'

// 创建QueryClient实例
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5分钟
      retry: 1
    }
  }
})

export interface AdminLayoutProps {
  children: React.ReactNode
}

/**
 * Admin页面布局组件
 * 
 * 提供必要的Context Providers：
 * - QueryClientProvider: React Query状态管理
 * - ToastProvider: Toast消息提示
 * - NotificationProvider: 通知消息
 */
export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <NotificationProvider>
          {children}
        </NotificationProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}