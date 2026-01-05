import React from 'react'
import { Toaster } from '@/components/ui/sonner'
import type { Metadata, Viewport } from 'next'
import { Providers } from '@/components/providers'
import { GlobalConfirmDialog } from '@/components/shared/global-confirm' // 引入组件
import { headers } from 'next/headers'
import './globals.css'
import type { AuthMeResponseDTO } from '@/schemas/auth.dto'

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
export default async function RootLayout({ children }: RootLayoutProps) {
  const headersList = await headers()
  const sessionHeader = headersList.get('x-user-session')
  let initialUser: AuthMeResponseDTO | null = null

  if (sessionHeader) {
    try {
      const session = JSON.parse(sessionHeader)
      initialUser = {
        id: session.userId,
        username: session.username
      }
    } catch (e) {
      // console.error('Failed to parse user session', e)
    }
  }

  return (
    <html lang="zh-CN">
      <body suppressHydrationWarning={true}>
        <Providers initialUser={initialUser}>
          <Toaster />
          {children}
          <GlobalConfirmDialog />
        </Providers>
      </body>
    </html>
  )
}
