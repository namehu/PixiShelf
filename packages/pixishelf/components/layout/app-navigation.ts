import { BookOpenIcon, HashIcon, HomeIcon, ImageIcon, ImagesIcon, SettingsIcon, UsersIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ROUTES } from '@/lib/constants'
import type { PageContainerSize } from './page-container'

export interface AppNavigationItem {
  href: string
  label: string
  icon: LucideIcon
}

export const PRIMARY_NAVIGATION_ITEMS: AppNavigationItem[] = [
  { href: ROUTES.DASHBOARD, label: '首页', icon: HomeIcon },
  { href: ROUTES.ARTWORKS, label: '作品', icon: ImageIcon },
  { href: ROUTES.VIEWER, label: '沉浸浏览', icon: ImagesIcon },
  { href: ROUTES.ARTISTS, label: '艺术家', icon: UsersIcon },
  { href: ROUTES.TAGS, label: '标签', icon: HashIcon },
  { href: ROUTES.SERIES, label: '系列', icon: BookOpenIcon }
]

export const MOBILE_BOTTOM_NAVIGATION_ITEMS = PRIMARY_NAVIGATION_ITEMS.slice(0, 3)

export const MORE_NAVIGATION_ITEMS = PRIMARY_NAVIGATION_ITEMS.slice(3)

export const ADMIN_NAVIGATION_ITEM: AppNavigationItem = {
  href: ROUTES.ADMIN,
  label: '管理',
  icon: SettingsIcon
}

export function isNavigationItemActive(pathname: string, href: string) {
  if (href === ROUTES.DASHBOARD) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function isMoreNavigationActive(pathname: string) {
  return [...MORE_NAVIGATION_ITEMS.map((item) => item.href), ROUTES.ADMIN, '/settings', ROUTES.CHANGE_PASSWORD].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`)
  )
}

export function getNavigationContainerSize(pathname: string): PageContainerSize {
  if (pathname === ROUTES.ARTWORKS) return 'gallery'
  if (pathname === ROUTES.ADMIN || pathname.startsWith(`${ROUTES.ADMIN}/`)) return 'workbench'
  return 'standard'
}
