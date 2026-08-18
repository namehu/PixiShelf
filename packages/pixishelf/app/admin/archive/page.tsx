import { Suspense } from 'react'
import { ArchiveManagement } from './_components/archive-management'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata = {
  title: '归档任务 - PixiShelf Admin'
}

export default function ArchivePage() {
  return (
    <AdminWorkbench title="归档任务" description="筛选、追踪并批量控制作品归档任务。">
      <Suspense fallback={null}>
        <ArchiveManagement />
      </Suspense>
    </AdminWorkbench>
  )
}
