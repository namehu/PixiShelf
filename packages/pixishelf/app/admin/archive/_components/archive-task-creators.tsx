'use client'

import { useState } from 'react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server'
import { Button } from '@/components/ui/button'
import { DiscoveryCreatorStatus } from './discovery-creator-status'
import { ArchiveTaskCreatorDialog } from './archive-task-creator-dialog'

export type ArchiveCreatorTask = inferRouterOutputs<AppRouter>['archive']['listTasks']['items'][number]

export function ArchiveTaskCreators({ task, compact = false }: { task: ArchiveCreatorTask; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [updated, setUpdated] = useState<{ base: ArchiveCreatorTask; value: ArchiveCreatorTask } | null>(null)
  const current = updated?.base === task ? updated.value : task
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
