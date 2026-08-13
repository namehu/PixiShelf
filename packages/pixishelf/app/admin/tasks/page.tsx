import { Metadata } from 'next'
import { Suspense } from 'react'
import { ListChecks } from 'lucide-react'
import { MaintenanceCard } from './_components/maintenance-card'

export const metadata: Metadata = {
  title: '后台任务 - PixiShelf Admin',
  description: '管理图库维护任务、媒体处理队列与自动执行计划'
}

export default function TasksPage() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600">
            <ListChecks className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-pretty text-2xl font-semibold tracking-tight text-foreground">后台任务</h1>
            <p className="mt-1 max-w-2xl text-pretty text-sm leading-6 text-muted-foreground">
              集中执行图库维护与媒体处理任务，并管理自动运行计划。
            </p>
          </div>
        </header>

        <Suspense fallback={<div className="py-12 text-sm text-muted-foreground">正在读取后台任务…</div>}>
          <MaintenanceCard />
        </Suspense>
      </div>
    </div>
  )
}
