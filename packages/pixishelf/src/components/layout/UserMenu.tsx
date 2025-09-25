'use client'
import { ROUTES } from '@/lib/constants'
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator
} from '@/components/ui/menubar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { UsersIcon, SettingsIcon, LogOutIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { memo } from 'react'
import { useAuth } from '@/components'

/**
 * 用户菜单组件
 */
const UserMenu = () => {
  const router = useRouter()
  const { user, logout } = useAuth()

  return (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger className="flex items-center cursor-pointer">
          <Avatar className="h-6 w-6">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {user?.username?.charAt(0).toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm text-gray-700 ml-2 hidden sm:inline">{user?.username}</span>
        </MenubarTrigger>

        <MenubarContent>
          <MenubarItem onClick={() => router.push(ROUTES.CHANGE_PASSWORD)}>
            <UsersIcon className="mr-2 h-4 w-4" />
            修改密码
          </MenubarItem>
          <MenubarItem onClick={() => router.push(ROUTES.ADMIN)}>
            <SettingsIcon className="mr-2 h-4 w-4" />
            管理后台
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => logout()}>
            <LogOutIcon className="mr-2 h-4 w-4" />
            登出
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  )
}

export default memo(UserMenu)
