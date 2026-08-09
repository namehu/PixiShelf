'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { KeyRoundIcon, LogOutIcon, MenuIcon, SlidersHorizontalIcon } from 'lucide-react'
import { useAuth, useAuthUser } from '@/components/auth'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import {
  ADMIN_NAVIGATION_ITEM,
  isNavigationItemActive,
  PRIMARY_NAVIGATION_ITEMS,
  type AppNavigationItem
} from './app-navigation'

function MobileNavigationLink({ item, pathname }: { item: AppNavigationItem; pathname: string }) {
  const active = isNavigationItemActive(pathname, item.href)
  const Icon = item.icon

  return (
    <SheetClose asChild>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
          active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
        )}
      >
        <Icon className="h-4 w-4" />
        <span>{item.label}</span>
      </Link>
    </SheetClose>
  )
}

export default function MobileNavigationMenu() {
  const pathname = usePathname()
  const user = useAuthUser()
  const { logout } = useAuth()

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="打开导航菜单">
          <MenuIcon className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(85vw,22rem)]">
        <SheetHeader className="border-b pr-12 text-left">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary text-primary-foreground">
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <SheetTitle className="truncate">{user?.name || '用户'}</SheetTitle>
              <SheetDescription className="truncate">PixiShelf 导航</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <nav aria-label="移动端主导航" className="flex flex-col gap-1 p-3">
          {PRIMARY_NAVIGATION_ITEMS.map((item) => (
            <MobileNavigationLink key={item.href} item={item} pathname={pathname} />
          ))}
          <div className="my-2 border-t border-slate-200" />
          <MobileNavigationLink item={ADMIN_NAVIGATION_ITEM} pathname={pathname} />
        </nav>

        <div className="mt-auto border-t border-slate-200 p-3">
          <SheetClose asChild>
            <Link
              href={ROUTES.SETTINGS_PROFILE}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            >
              <SlidersHorizontalIcon className="h-4 w-4" />
              个人设置
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <Link
              href={ROUTES.CHANGE_PASSWORD}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            >
              <KeyRoundIcon className="h-4 w-4" />
              修改密码
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <LogOutIcon className="h-4 w-4" />
              退出登录
            </button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  )
}
