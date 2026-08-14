import { Metadata } from 'next'
import { Suspense } from 'react'
import { MaintenanceCard } from './_components/maintenance-card'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata: Metadata = {
  title: '后台任务 - PixiShelf Admin',
  description: '管理图库维护任务、媒体处理队列与自动执行计划'
}

export default function TasksPage() {
  return (
    <AdminWorkbench title="后台任务" description="集中执行图库维护与媒体处理任务，并管理自动运行计划。">
      <div className="mx-auto max-w-6xl">
        <Suspense fallback={<div className="py-12 text-sm text-muted-foreground">正在读取后台任务…</div>}>
          <MaintenanceCard />
        </Suspense>
      </div>
    </AdminWorkbench>
  )
}
