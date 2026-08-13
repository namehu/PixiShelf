'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { EllipsisIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isMoreNavigationActive, isNavigationItemActive, MOBILE_BOTTOM_NAVIGATION_ITEMS } from './app-navigation'
import MobileNavigationMenu from './mobile-navigation-menu'

export default function MobileBottomNavigation() {
  const pathname = usePathname()
  const moreActive = isMoreNavigationActive(pathname)

  return (
    <nav
      aria-label="手机主导航"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface-raised/96 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto grid min-h-16 max-w-md grid-cols-4">
        {MOBILE_BOTTOM_NAVIGATION_ITEMS.map((item) => {
          const active = isNavigationItemActive(pathname, item.href)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex min-h-16 flex-col items-center justify-center gap-1 px-2 text-[0.6875rem] font-medium text-muted-foreground outline-none transition-colors before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:rounded-full before:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
                active && 'text-primary before:bg-brand-accent'
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          )
        })}

        <MobileNavigationMenu
          trigger={
            <button
              type="button"
              className={cn(
                'relative flex min-h-16 flex-col items-center justify-center gap-1 px-2 text-[0.6875rem] font-medium text-muted-foreground outline-none transition-colors before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:rounded-full before:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
                moreActive && 'text-primary before:bg-brand-accent'
              )}
              aria-label={moreActive ? '更多，当前页面位于更多导航' : '更多'}
            >
              <EllipsisIcon className="size-5" aria-hidden="true" />
              <span aria-hidden="true">更多</span>
            </button>
          }
        />
      </div>
    </nav>
  )
}
