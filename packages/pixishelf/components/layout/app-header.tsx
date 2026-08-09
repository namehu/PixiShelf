'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import PLogo from './p-logo'
import UserMenu from './user-menu'
import MobileNavigationMenu from './mobile-navigation-menu'
import {
  ADMIN_NAVIGATION_ITEM,
  isNavigationItemActive,
  PRIMARY_NAVIGATION_ITEMS,
  type AppNavigationItem,
  usesContextualMobileToolbar
} from './app-navigation'

function NavigationLink({ item, pathname }: { item: AppNavigationItem; pathname: string }) {
  const active = isNavigationItemActive(pathname, item.href)
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
        'px-3 py-2',
        active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{item.label}</span>
    </Link>
  )
}

export default function AppHeader() {
  const pathname = usePathname()

  return (
    <header
      className={cn(
        'sticky top-0 z-50 h-14 w-full border-b border-slate-200/60 bg-white/85 backdrop-blur-xl lg:h-16',
        usesContextualMobileToolbar(pathname) && 'hidden lg:block'
      )}
    >
      <div className="mx-auto flex h-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href={ROUTES.DASHBOARD}
          aria-label="返回首页"
          className="flex shrink-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/10">
            <PLogo className="text-white" size="small" />
          </div>
          <span className="hidden text-lg font-bold tracking-tight text-slate-900 sm:inline">PixiShelf</span>
        </Link>

        <nav aria-label="主导航" className="ml-2 hidden flex-1 items-center gap-1 lg:flex">
          {PRIMARY_NAVIGATION_ITEMS.map((item) => (
            <NavigationLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <div className="hidden lg:block">
            <NavigationLink item={ADMIN_NAVIGATION_ITEM} pathname={pathname} />
          </div>

          <div className="hidden lg:block">
            <UserMenu />
          </div>
          <MobileNavigationMenu />
        </div>
      </div>
    </header>
  )
}
