import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminWorkbench } from '../../_components/admin-workbench'
import { ArchiveInbox } from './_components/archive-inbox'

export const metadata = {
  title: '归档收件箱 - PixiShelf Admin'
}

export default function ArchiveInboxPage() {
  return (
    <AdminWorkbench
      title="归档收件箱"
      description="持续添加作品链接，在真实 FIFO 队列中解析、判断并批量归档。"
      eyebrow="链接归档"
    >
      <Suspense fallback={<ArchiveInboxFallback />}>
        <ArchiveInbox />
      </Suspense>
    </AdminWorkbench>
  )
}

function ArchiveInboxFallback() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}
