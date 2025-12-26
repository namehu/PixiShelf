import React from 'react'
import { Toaster } from '@/components/ui/sonner'
import type { Metadata, Viewport } from 'next'
import { Providers } from '@/components/providers'
import { GlobalConfirmDialog } from '@/components/shared/global-confirm' // 引入组件
import './globals.css'

export const metadata: Metadata = {
  title: 'Pixishelf - 艺术家作品管理平台',
  description: '专为艺术家设计的作品管理和展示平台',
  openGraph: {
    title: 'PixiShelf',
    description: '你的个人数字画廊'
  },
  keywords: ['艺术', '作品管理', '艺术家', '画廊', '展示']
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1
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
      <body suppressHydrationWarning={true}>
        <Providers>
          {children}
          <GlobalConfirmDialog />
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
