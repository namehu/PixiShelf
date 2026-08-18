import {
  Activity,
  AlbumIcon,
  Archive,
  Inbox,
  History,
  ImageIcon,
  LayoutDashboardIcon,
  ListTodo,
  Settings,
  Tags,
  Users,
  UserStar
} from 'lucide-react'

export const adminHomeSection = {
  title: '管理概览',
  description: '查看全部管理模块',
  href: '/admin',
  icon: LayoutDashboardIcon
}

export const sections = [
  {
    title: '状态管理',
    description: '查看系统运行状态和统计数据',
    href: '/admin/statistics',
    icon: Activity,
    group: 'overview'
  },

  {
    title: '标签管理',
    description: '管理图片标签和翻译',
    href: '/admin/tags',
    icon: Tags,
    group: 'library'
  },
  {
    title: '作品管理',
    description: '管理作品信息',
    href: '/admin/artworks',
    icon: ImageIcon,
    group: 'library'
  },
  {
    title: '归档收件箱',
    description: '持续添加、解析并选择归档链接',
    href: '/admin/archive/inbox',
    icon: Inbox,
    group: 'library'
  },
  {
    title: '归档任务',
    description: '追踪并控制作品归档任务',
    href: '/admin/archive',
    icon: Archive,
    group: 'library'
  },
  {
    title: '艺术家管理',
    description: '管理艺术家信息',
    href: '/admin/artists',
    icon: UserStar,
    group: 'library'
  },
  {
    title: '系列管理',
    description: '管理系列作品信息',
    href: '/admin/series',
    icon: AlbumIcon,
    group: 'library'
  },
  {
    title: '用户管理',
    description: '管理注册用户和权限',
    href: '/admin/users',
    icon: Users,
    group: 'system'
  },
  {
    title: '扫描管理',
    description: '配置扫描路径和系统选项',
    href: '/admin/setting',
    icon: Settings,
    group: 'system'
  },
  {
    title: '扫描历史',
    description: '查看扫描和导入审计记录',
    href: '/admin/scan-history',
    icon: History,
    group: 'system'
  },
  {
    title: '任务计划',
    description: '执行系统维护和后台任务',
    href: '/admin/tasks',
    icon: ListTodo,
    group: 'system'
  }
]

export const adminNavigationGroups = [
  {
    id: 'overview',
    label: '概览',
    items: [adminHomeSection, ...sections.filter((section) => section.group === 'overview')]
  },
  {
    id: 'library',
    label: '内容档案',
    items: sections.filter((section) => section.group === 'library')
  },
  {
    id: 'system',
    label: '系统工具',
    items: sections.filter((section) => section.group === 'system')
  }
]

export function getActiveAdminSection(pathname: string | null) {
  if (!pathname) return undefined
  if (pathname === adminHomeSection.href) return adminHomeSection
  return sections.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`))
}

export function isAdminNavigationItemActive(pathname: string | null, href: string) {
  if (!pathname) return false
  return getActiveAdminSection(pathname)?.href === href
}
