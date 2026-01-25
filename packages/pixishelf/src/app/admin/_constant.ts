import { Activity, AlbumIcon, Settings, Tags, Users, UserStar, ImageIcon } from 'lucide-react'

export const sections = [
  {
    title: '状态管理',
    description: '查看系统运行状态和统计数据',
    href: '/admin/statistics',
    icon: Activity,
    color: 'text-blue-500'
  },
  {
    title: '标签管理',
    description: '管理图片标签和翻译',
    href: '/admin/tags',
    icon: Tags,
    color: 'text-green-500'
  },
  {
    title: '作品管理',
    description: '管理作品信息',
    href: '/admin/artworks',
    icon: ImageIcon,
    color: 'text-pink-500'
  },
  {
    title: '艺术家管理',
    description: '管理艺术家信息',
    href: '/admin/artists',
    icon: UserStar,
    color: 'text-pink-500'
  },
  {
    title: '系列管理',
    description: '管理系列作品信息',
    href: '/admin/series',
    icon: AlbumIcon,
    color: 'text-gray-500'
  },
  {
    title: '用户管理',
    description: '管理注册用户和权限',
    href: '/admin/users',
    icon: Users,
    color: 'text-purple-500'
  },
  {
    title: '扫描管理',
    description: '配置扫描路径和系统选项',
    href: '/admin/setting',
    icon: Settings,
    color: 'text-slate-500'
  }
]
