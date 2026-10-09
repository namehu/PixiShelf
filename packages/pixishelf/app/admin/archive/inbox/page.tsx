import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminWorkbench } from '../../_components/admin-workbench'
import { ArchiveInboxWorkspace } from './_components/archive-inbox-workspace'

export const metadata = {
  title: '归档收件箱 - PixiShelf Admin'
}

export default function ArchiveInboxPage() {
  return (
    <Suspense fallback={<ArchiveInboxFallback />}>
      <ArchiveInboxWorkspace />
    </Suspense>
  )
}

function ArchiveInboxFallback() {
  return (
    <AdminWorkbench title="归档收件箱" eyebrow={null}>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-96 w-full" />
    </AdminWorkbench>
  )
}
