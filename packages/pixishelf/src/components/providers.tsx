'use client'

import React from 'react'
import { AuthProvider } from '@/components/auth'
import type { AuthMeResponseDTO } from '@/schemas/auth.dto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink, loggerLink } from '@trpc/client'
import { useState } from 'react'
import { TRPCProvider as TRPCClientProvider } from '@/lib/trpc'
import type { AppRouter } from '@/server'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 60 * 1000
      }
    }
  })
}
let browserQueryClient: QueryClient | undefined = undefined

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return makeQueryClient()
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important, so we don't re-make a new client if React
    // suspends during the initial render. This may not be needed if we
    // have a suspense boundary BELOW the creation of the query client
    if (!browserQueryClient) browserQueryClient = makeQueryClient()
    return browserQueryClient
  }
}

const queryClient = getQueryClient()

export interface ProvidersProps {
  children: React.ReactNode
  initialUser?: AuthMeResponseDTO | null
}

/**
 * 应用程序的所有 Context Providers
 */
export function Providers({ children, initialUser }: ProvidersProps) {
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
        <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
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
