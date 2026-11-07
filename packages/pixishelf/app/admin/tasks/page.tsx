import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { MaintenanceCard } from './_components/maintenance-card'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata: Metadata = {
  title: '后台任务 - PixiShelf Admin',
  description: '管理图库维护任务、媒体处理队列与自动执行计划'
}

export default async function TasksPage({
  searchParams
}: {
  searchParams: Promise<{ task?: string | string[]; jobId?: string | string[]; entry?: string | string[] }>
}) {
  const { task, jobId, entry } = await searchParams
  if (task === 'video-streaming' && jobId === undefined) {
    const entryQuery = entry === 'direct' || entry === 'privacy' ? `?entry=${entry}` : ''
    redirect(`/admin/tasks/video-streaming-optimization${entryQuery}`)
  }
  return (
    <AdminWorkbench title="后台任务" description="执行图库维护与媒体处理任务，并在原处跟踪运行结果。">
      <Suspense fallback={<div className="py-12 text-sm text-muted-foreground">正在读取后台任务…</div>}>
        <MaintenanceCard />
      </Suspense>
    </AdminWorkbench>
  )
}
