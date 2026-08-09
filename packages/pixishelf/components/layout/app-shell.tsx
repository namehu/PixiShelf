'use client'

import type { PropsWithChildren } from 'react'
import { usePathname } from 'next/navigation'
import { useAuthUser } from '@/components/auth'
import { ROUTES } from '@/lib/constants'
import AppHeader from './app-header'

const HEADERLESS_ROUTES = [ROUTES.LOGIN, ROUTES.VIEWER, '/artworks/preview'] as const

export function isHeaderlessPath(pathname: string) {
  return HEADERLESS_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

export default function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname()
  const user = useAuthUser()
  const showHeader = Boolean(user) && !isHeaderlessPath(pathname)

  return (
    <>
      {showHeader && <AppHeader />}
      {children}
    </>
  )
}
