import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminWorkbench } from '../../_components/admin-workbench'
import { ArchiveInboxWorkspace } from './_components/archive-inbox-workspace'

export const metadata = {
  title: '归档收件箱 - PixiShelf Admin'
}

export default function ArchiveInboxPage() {
  return (
    <AdminWorkbench title="归档收件箱" description="粘贴作品链接；解析、判断和归档会在后台继续进行。" eyebrow={null}>
      <Suspense fallback={<ArchiveInboxFallback />}>
        <ArchiveInboxWorkspace />
      </Suspense>
    </AdminWorkbench>
  )
}

function ArchiveInboxFallback() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8 pt-6">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}
