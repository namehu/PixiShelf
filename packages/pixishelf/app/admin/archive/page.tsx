import { Suspense } from 'react'
import { ArchiveManagement } from './_components/archive-management'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata = {
  title: '归档任务 - PixiShelf Admin'
}

export default function ArchivePage() {
  return (
    <Suspense fallback={<AdminWorkbench title="归档任务" eyebrow={null} />}>
      <ArchiveManagement />
    </Suspense>
  )
}
