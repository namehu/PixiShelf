'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server'
import { Button } from '@/components/ui/button'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { DiscoveryCreatorStatus } from './discovery-creator-status'
import { ArchiveTaskCreatorDialog } from './archive-task-creator-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type ArchiveCreatorTask = inferRouterOutputs<AppRouter>['archive']['listTasks']['items'][number]

export function ArchiveTaskCreators({ task, compact = false }: { task: ArchiveCreatorTask; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [updated, setUpdated] = useState<{ base: ArchiveCreatorTask; value: ArchiveCreatorTask } | null>(null)
  const current = updated?.base === task ? updated.value : task
  if (compact) {
    const effective = current.effectiveCreators ?? []
    const pending = current.pendingCreators ?? []
    const creators = [...effective, ...pending].slice(0, 3)
    const hidden = effective.length + pending.length - creators.length
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
        {creators.length === 0 && <span className="truncate">未绑定艺术家</span>}
        {creators.map((creator, index) => (
          <Tooltip key={creator.id}>
            <TooltipTrigger asChild>
              <Link
                href={`/artists/${creator.id}`}
                className={cn(
                  'min-w-0 max-w-40 flex-1 truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  index < effective.length ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                <PrivacySensitiveText>{creator.name}</PrivacySensitiveText>
                <span className="sr-only">{index < effective.length ? '（已绑定）' : '（归档发布后生效）'}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              <PrivacySensitiveText>{creator.name}</PrivacySensitiveText> ·{' '}
              {index < effective.length ? '已绑定当前作品' : '归档发布后生效'}
            </TooltipContent>
          </Tooltip>
        ))}
        {hidden > 0 && <span className="shrink-0">+{hidden}</span>}
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <DiscoveryCreatorStatus
        effectiveCreators={current.effectiveCreators}
        pendingCreators={current.pendingCreators}
        maxVisible={compact ? 3 : undefined}
      />
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        管理艺术家
      </Button>
      {open && (
        <ArchiveTaskCreatorDialog
          taskId={task.id}
          onClose={() => setOpen(false)}
          onUpdated={(value) => setUpdated({ base: task, value })}
        />
      )}
    </div>
  )
}
