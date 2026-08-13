'use client'
import Link from 'next/link'
import { ROUTES } from '@/lib/constants'
import {
  Menubar,
  MenubarGroup,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator
} from '@/components/ui/menubar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { KeyRoundIcon, LogOutIcon, SlidersHorizontalIcon } from 'lucide-react'
import { memo } from 'react'
import { useAuth, useAuthUser } from '@/components/auth'

/**
 * 用户菜单组件
 */
const UserMenu = () => {
  const user = useAuthUser()
  const { logout } = useAuth()

  return (
    <Menubar className="border-0 bg-transparent p-0 shadow-none">
      <MenubarMenu>
        <MenubarTrigger className="h-10 cursor-pointer gap-2 px-2" aria-label="打开账户菜单">
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-28 truncate text-sm text-foreground xl:inline">{user?.name || '用户'}</span>
        </MenubarTrigger>

        <MenubarContent align="end">
          <MenubarGroup>
            <MenubarItem asChild>
              <Link href={ROUTES.SETTINGS_PROFILE}>
                <SlidersHorizontalIcon data-icon="inline-start" />
                个人设置
              </Link>
            </MenubarItem>
            <MenubarItem asChild>
              <Link href={ROUTES.CHANGE_PASSWORD}>
                <KeyRoundIcon data-icon="inline-start" />
                修改密码
              </Link>
            </MenubarItem>
          </MenubarGroup>
          <MenubarSeparator />
          <MenubarGroup>
            <MenubarItem variant="destructive" onSelect={() => void logout()}>
              <LogOutIcon data-icon="inline-start" />
              退出登录
            </MenubarItem>
          </MenubarGroup>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  )
}

export default memo(UserMenu)
