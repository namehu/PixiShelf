'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { adminNavigationGroups, isAdminNavigationItemActive } from '../_constant'

interface AdminNavProps {
  className?: string
  onNavigate?: () => void
}

export function AdminNav({ className, onNavigate }: AdminNavProps) {
  const pathname = usePathname()

  return (
    <nav aria-label="管理模块" className={cn('flex flex-col gap-5 p-4', className)}>
      {adminNavigationGroups.map((group) => (
        <div key={group.id} role="group" aria-labelledby={`admin-nav-${group.id}`}>
          <p
            id={`admin-nav-${group.id}`}
            className="font-utility mb-2 px-3 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase"
          >
            {group.label}
          </p>
          <div className="flex flex-col gap-1">
            {group.items.map((item) => {
              const active = isAdminNavigationItemActive(pathname, item.href)
              const Icon = item.icon

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={onNavigate}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/50',
                    active && 'bg-sidebar-accent text-sidebar-accent-foreground'
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span>{item.title}</span>
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
