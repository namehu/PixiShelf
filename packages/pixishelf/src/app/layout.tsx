import React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { AuthProvider } from '@/components'
import './globals.css'

// ============================================================================
// 根布局组件
// ============================================================================
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Artisan Shelf - 艺术家作品管理平台',
  description: '专为艺术家设计的作品管理和展示平台',
  keywords: ['艺术', '作品管理', '艺术家', '画廊', '展示'],
  authors: [{ name: 'Artisan Shelf Team' }],
  viewport: 'width=device-width, initial-scale=1'
}

export interface RootLayoutProps {
  children: React.ReactNode
}

/**
 * 根布局组件
 */
export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
