'use client'

import React from 'react'
import { ToastProvider } from '@/components/ui/toast'
import { NotificationProvider } from '@/components/ui/notification'

export interface AdminLayoutProps {
  children: React.ReactNode
}

/**
 * Admin页面布局组件
 * 
 * 提供必要的Context Providers：
 * - ToastProvider: Toast消息提示
 * - NotificationProvider: 通知消息
 * 
 * 注意：QueryClientProvider 现在由根布局提供
 */
export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <ToastProvider>
      <NotificationProvider>
        {children}
      </NotificationProvider>
    </ToastProvider>
  )
}