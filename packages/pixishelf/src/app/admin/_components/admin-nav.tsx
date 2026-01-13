'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Settings, Tags, Users, Activity } from 'lucide-react'

const navItems = [
  { href: '/admin', label: '总览', icon: LayoutDashboard },
  { href: '/admin/statistics', label: '统计管理', icon: Activity },
  { href: '/admin/tags', label: '标签管理', icon: Tags },
  { href: '/admin/users', label: '用户管理', icon: Users },
  { href: '/admin/setting', label: '设置管理', icon: Settings }
]

export function AdminNav({ className }: { className?: string }) {
  const pathname = usePathname()

  return (
    <nav className={cn('flex flex-col space-y-1 p-2 border-r bg-white', className)}>
      <div className="mb-4 px-2 text-xs font-semibold uppercase text-muted-foreground tracking-wider">管理菜单</div>
      {navItems.map((item) => {
        const isActive = item.href === '/admin' ? pathname === '/admin' : pathname?.startsWith(item.href)

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
