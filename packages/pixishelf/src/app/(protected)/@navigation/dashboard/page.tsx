/* eslint-disable jsx-a11y/alt-text */
import { ROUTES } from '@/lib/constants'
import { UsersIcon, ImageIcon, HashIcon, ImageUpIcon } from 'lucide-react'
import Link from 'next/link'

/**
 * 主导航菜单组件
 */
const DashboardNavigation = () => {
  return (
    <div className="flex gap-4">
      <Link href={ROUTES.GALLERY} className="flex flex-row items-center gap-2 p-2 hover:bg-gray-100 rounded">
        <ImageIcon className="h-5 w-5" />
        <span className="hidden sm:inline">作品</span>
      </Link>
      <Link href={ROUTES.ARTISTS} className="flex flex-row items-center gap-2 p-2 hover:bg-gray-100 rounded">
        <UsersIcon className="h-5 w-5" />
        <span className="hidden sm:inline">艺术家</span>
      </Link>
      <Link href={ROUTES.TAGS} className="flex flex-row items-center gap-2 p-2 hover:bg-gray-100 rounded">
        <HashIcon className="h-5 w-5" />
        <span className="hidden sm:inline">标签</span>
      </Link>
      <Link href={ROUTES.VIEWER} className="flex flex-row items-center gap-2 p-2 hover:bg-gray-100 rounded">
        <ImageUpIcon className="h-5 w-5" />
        <span className="hidden sm:inline">刷图</span>
      </Link>
    </div>
  )
}

export default DashboardNavigation
