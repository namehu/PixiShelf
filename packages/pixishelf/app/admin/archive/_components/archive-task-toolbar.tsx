'use client'

import { SlidersHorizontal } from 'lucide-react'
import { TaskFiltersForm } from './archive-task-filters'
import type { ComponentProps } from 'react'

export function ArchiveTaskToolbar(props: ComponentProps<typeof TaskFiltersForm>) {
  return (
    <section
      aria-label="归档任务筛选"
      className="sticky top-14 z-20 -mx-4 border-b bg-background px-4 py-3 sm:-mx-6 sm:px-6 lg:top-16 lg:-mx-8 lg:px-8"
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        筛选任务
      </h2>
      <TaskFiltersForm {...props} />
    </section>
  )
}
