/* eslint-disable jsx-a11y/alt-text */
import { ROUTES } from '@/lib/constants'
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink
} from '@/components/ui/navigation-menu'
import { UsersIcon, ImageIcon, HashIcon } from 'lucide-react'
import Link from 'next/link'

/**
 * 主导航菜单组件
 */
const MainNavigation = () => (
  <NavigationMenu>
    <NavigationMenuList>
      <NavigationMenuItem>
        <NavigationMenuLink asChild>
          <Link href={ROUTES.GALLERY} className="flex flex-row items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            <span className="hidden sm:inline">作品</span>
          </Link>
        </NavigationMenuLink>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuLink asChild>
          <Link href={ROUTES.ARTISTS} className="flex flex-row items-center gap-2">
            <UsersIcon className="h-4 w-4" />
            <span className="hidden sm:inline">艺术家</span>
          </Link>
        </NavigationMenuLink>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuLink asChild>
          <Link href={ROUTES.TAGS} className="flex flex-row items-center gap-2">
            <HashIcon className="h-4 w-4" />
            <span className="hidden sm:inline">标签</span>
          </Link>
        </NavigationMenuLink>
      </NavigationMenuItem>
    </NavigationMenuList>
  </NavigationMenu>
)

export default MainNavigation
