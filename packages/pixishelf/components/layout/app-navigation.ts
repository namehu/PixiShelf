import { BookOpenIcon, HashIcon, HomeIcon, ImageIcon, SettingsIcon, UsersIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ROUTES } from '@/lib/constants'

export interface AppNavigationItem {
  href: string
  label: string
  icon: LucideIcon
}

export const PRIMARY_NAVIGATION_ITEMS: AppNavigationItem[] = [
  { href: ROUTES.DASHBOARD, label: '首页', icon: HomeIcon },
  { href: ROUTES.ARTWORKS, label: '作品', icon: ImageIcon },
  { href: ROUTES.ARTISTS, label: '艺术家', icon: UsersIcon },
  { href: ROUTES.TAGS, label: '标签', icon: HashIcon },
  { href: ROUTES.SERIES, label: '系列', icon: BookOpenIcon }
]

export const ADMIN_NAVIGATION_ITEM: AppNavigationItem = {
  href: ROUTES.ADMIN,
  label: '管理',
  icon: SettingsIcon
}

export function isNavigationItemActive(pathname: string, href: string) {
  if (href === ROUTES.DASHBOARD) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function usesContextualMobileToolbar(pathname: string) {
  if (pathname === ROUTES.ARTWORKS || pathname.startsWith(`${ROUTES.ARTWORKS}/`)) return true
  if (pathname === ROUTES.ARTISTS || pathname.startsWith(`${ROUTES.ARTISTS}/`)) return true
  if (pathname === ROUTES.TAGS || pathname.startsWith(`${ROUTES.TAGS}/`)) return true

  return pathname.startsWith(`${ROUTES.SERIES}/`)
}
