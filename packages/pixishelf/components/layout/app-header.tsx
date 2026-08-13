'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { PageContainer } from './page-container'
import PLogo from './p-logo'
import UserMenu from './user-menu'
import {
  ADMIN_NAVIGATION_ITEM,
  getNavigationContainerSize,
  isNavigationItemActive,
  PRIMARY_NAVIGATION_ITEMS,
  type AppNavigationItem
} from './app-navigation'

function NavigationLink({ item, pathname }: { item: AppNavigationItem; pathname: string }) {
  const active = isNavigationItemActive(pathname, item.href)
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        active &&
          'bg-accent text-accent-foreground after:absolute after:inset-x-3 after:-bottom-[0.8125rem] after:h-0.5 after:rounded-full after:bg-brand-accent'
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  )
}

export default function AppHeader() {
  const pathname = usePathname()
  const containerSize = getNavigationContainerSize(pathname)

  return (
    <header className="sticky top-0 z-50 hidden h-16 w-full border-b border-border bg-background/92 backdrop-blur-xl lg:block">
      <PageContainer size={containerSize} className="flex h-full items-center gap-3">
        <Link
          href={ROUTES.DASHBOARD}
          aria-label="返回首页"
          className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-brand-accent">
            <PLogo className="text-white" size="small" />
          </span>
          <span className="text-lg font-semibold tracking-[-0.025em] text-foreground">PixiShelf</span>
        </Link>

        <nav aria-label="主导航" className="ml-2 hidden flex-1 items-center gap-1 lg:flex">
          {PRIMARY_NAVIGATION_ITEMS.map((item) => (
            <NavigationLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <NavigationLink item={ADMIN_NAVIGATION_ITEM} pathname={pathname} />
          <UserMenu />
        </div>
      </PageContainer>
    </header>
  )
}
