'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { KeyRoundIcon, LogOutIcon, SlidersHorizontalIcon } from 'lucide-react'
import { useAuth, useAuthUser } from '@/components/auth'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
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
  MORE_NAVIGATION_ITEMS,
  type AppNavigationItem
} from './app-navigation'

interface MobileNavigationMenuProps {
  trigger: ReactNode
}

function MobileNavigationLink({ item, pathname }: { item: AppNavigationItem; pathname: string }) {
  const active = isNavigationItemActive(pathname, item.href)
  const Icon = item.icon

  return (
    <SheetClose asChild>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
          active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
        <span>{item.label}</span>
      </Link>
    </SheetClose>
  )
}

function UtilityLink({
  href,
  icon,
  pathname,
  children
}: {
  href: string
  icon: ReactNode
  pathname: string
  children: ReactNode
}) {
  const active = isNavigationItemActive(pathname, href)

  return (
    <SheetClose asChild>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-12 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
          active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
        )}
      >
        {icon}
        <span>{children}</span>
      </Link>
    </SheetClose>
  )
}

export default function MobileNavigationMenu({ trigger }: MobileNavigationMenuProps) {
  const pathname = usePathname()
  const user = useAuthUser()
  const { logout } = useAuth()

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        closeLabel="关闭更多导航"
        className="max-h-[85dvh] overflow-hidden rounded-t-surface border-border bg-surface-raised p-0 shadow-floating"
      >
        <SheetHeader className="border-b border-border pr-14 text-left">
          <div className="flex items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback className="bg-primary text-primary-foreground">
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <SheetTitle className="truncate">{user?.name || '用户'}</SheetTitle>
              <SheetDescription className="truncate">浏览收藏与管理工具</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <nav aria-label="更多导航" className="flex flex-col gap-1">
            <p className="font-utility px-3 py-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
              收藏索引
            </p>
            {MORE_NAVIGATION_ITEMS.map((item) => (
              <MobileNavigationLink key={item.href} item={item} pathname={pathname} />
            ))}

            <Separator className="my-2" />
            <p className="font-utility px-3 py-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
              工具
            </p>
            <MobileNavigationLink item={ADMIN_NAVIGATION_ITEM} pathname={pathname} />
            <UtilityLink
              href={ROUTES.SETTINGS_PROFILE}
              icon={<SlidersHorizontalIcon className="size-5" aria-hidden="true" />}
              pathname={pathname}
            >
              个人设置
            </UtilityLink>
            <UtilityLink
              href={ROUTES.CHANGE_PASSWORD}
              icon={<KeyRoundIcon className="size-5" aria-hidden="true" />}
              pathname={pathname}
            >
              修改密码
            </UtilityLink>
          </nav>

          <Separator className="my-2" />
          <SheetClose asChild>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-destructive/30"
            >
              <LogOutIcon className="size-5" aria-hidden="true" />
              <span>退出登录</span>
            </button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  )
}
