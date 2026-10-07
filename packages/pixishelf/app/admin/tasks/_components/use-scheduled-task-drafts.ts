'use client'

import { useEffect, useState } from 'react'
import type { ScheduledTaskView, TaskDraft } from './task-ui'

export function useScheduledTaskDrafts(tasks: ScheduledTaskView[]) {
  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({})

  useEffect(() => {
    if (tasks.length === 0) return
    setDrafts((current) => {
      const next = { ...current }
      for (const task of tasks) {
        next[task.key] ??= {
          enabled: task.enabled,
          priority: String(task.priority)
        }
      }
      return next
    })
  }, [tasks])

  const updateDraft = (key: string, patch: Partial<TaskDraft>) => {
    setDrafts((current) => ({
      ...current,
      [key]: {
        enabled: false,
        priority: '100',
        ...current[key],
        ...patch
      }
    }))
  }

  return { drafts, updateDraft }
}
