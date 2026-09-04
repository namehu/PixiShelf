'use client'

import React, { Suspense } from 'react'
import { AuthProvider } from '@/components/auth'
import type { AuthMeResponseDTO } from '@/schemas/auth.dto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink, loggerLink } from '@trpc/client'
import { useState } from 'react'
import { TRPCProvider as TRPCClientProvider } from '@/lib/trpc'
import type { AppRouter } from '@/server'
import { UserSettingProvider } from '@/components/user-setting'
import type { UserSettings } from '@/schemas/user-setting.dto'
import { NavigationHistoryTracker } from '@/components/navigation-history-tracker'
import AppShell from '@/components/layout/app-shell'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // SSR 下建议将 staleTime 设为大于 0，
        // 避免客户端刚挂载时立即再次拉取数据
        staleTime: 60 * 1000
      }
    }
  })
}
let browserQueryClient: QueryClient | undefined = undefined

function getQueryClient() {
  if (typeof window === 'undefined') {
    // 服务端每次请求都创建独立 QueryClient，避免状态串流
    return makeQueryClient()
  }
  // 浏览器端仅首次创建 QueryClient（并复用），避免每次渲染都重建实例
  // 这是为了规避 SSR 水合首屏时因 React Suspense 而重复发起请求的竞态
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}

const queryClient = getQueryClient()

export interface ProvidersProps {
  children: React.ReactNode
  initialUser?: AuthMeResponseDTO | null
  initialSettings?: UserSettings
}

/**
 * 应用程序的所有 Context Providers
 */
export function Providers({ children, initialUser, initialSettings }: ProvidersProps) {
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        // 开发环境打印详细日志，生产环境只打印错误
        loggerLink({
          enabled: (opts) =>
            process.env.NODE_ENV === 'development' || (opts.direction === 'down' && opts.result instanceof Error)
        }),
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`
        })
      ]
    })
  )
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCClientProvider trpcClient={trpcClient} queryClient={queryClient}>
        <AuthProvider initialUser={initialUser}>
          <UserSettingProvider
            initialSettings={initialSettings}
            initialUserId={initialUser?.id == null ? null : String(initialUser.id)}
          >
            <Suspense fallback={null}>
              <NavigationHistoryTracker />
            </Suspense>
            <AppShell>{children}</AppShell>
          </UserSettingProvider>
        </AuthProvider>
      </TRPCClientProvider>
    </QueryClientProvider>
  )
}

function getBaseUrl() {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.location.origin
}
