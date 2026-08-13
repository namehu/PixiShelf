'use client'

import type { PropsWithChildren } from 'react'
import { usePathname } from 'next/navigation'
import { useAuthUser } from '@/components/auth'
import { ContentWarningGate } from '@/components/content-warning/content-warning-gate'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import AppHeader from './app-header'
import MobileBottomNavigation from './mobile-bottom-navigation'

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
      <ContentWarningGate />
      {showHeader && (
        <a
          href="#main-content"
          className="fixed top-2 left-4 z-[100] -translate-y-16 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-floating outline-none transition-transform focus:translate-y-0"
        >
          跳到主要内容
        </a>
      )}
      {showHeader && <AppHeader />}
      <div
        id="main-content"
        tabIndex={-1}
        className={cn(showHeader && 'pb-[var(--app-mobile-navigation-offset)] outline-none lg:pb-0')}
      >
        {children}
      </div>
      {showHeader && <MobileBottomNavigation />}
    </>
  )
}
