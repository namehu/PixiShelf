'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { useTRPC } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { adminNavigationGroups, isAdminNavigationItemActive } from '../_constant'

interface AdminNavProps {
  className?: string
  onNavigate?: () => void
}

export function AdminNav({ className, onNavigate }: AdminNavProps) {
  const pathname = usePathname()
  const trpc = useTRPC()
  const archiveSummaryQuery = useQuery(
    trpc.archiveInbox.summary.queryOptions(undefined, {
      retry: false,
      refetchInterval: (query) => ((query.state.data?.activeCount ?? 0) > 0 ? 1_500 : 8_000)
    })
  )
  const archiveCounts = archiveSummaryQuery.data
    ? { waiting: archiveSummaryQuery.data.queuedCount, failed: archiveSummaryQuery.data.counts.FAILED }
    : null

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
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.href === '/admin/archive/inbox' && archiveCounts ? (
                    <span className="ml-auto flex shrink-0 items-center gap-1" translate="no">
                      {archiveCounts.waiting > 0 ? (
                        <Badge
                          variant="info"
                          className="min-w-5 justify-center px-1.5 font-mono tabular-nums"
                          aria-label={`归档收件箱等待 ${archiveCounts.waiting} 项`}
                        >
                          等 {compactCount(archiveCounts.waiting)}
                        </Badge>
                      ) : null}
                      {archiveCounts.failed > 0 ? (
                        <Badge
                          variant="destructive"
                          className="min-w-5 justify-center px-1.5 font-mono tabular-nums"
                          aria-label={`归档收件箱失败 ${archiveCounts.failed} 项`}
                        >
                          失 {compactCount(archiveCounts.failed)}
                        </Badge>
                      ) : null}
                    </span>
                  ) : null}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

function compactCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}
