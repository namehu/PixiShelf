import { Metadata } from 'next'
import { Suspense } from 'react'
import { ScanHistoryManagement } from './_components/scan-history-management'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata: Metadata = {
  title: '扫描历史 - PixiShelf Admin',
  description: '查看扫描运行记录与作品级处理明细'
}

export default function ScanHistoryPage() {
  return (
    <AdminWorkbench title="扫描历史" description="查看每次扫描运行、作品级明细与失败原因。">
      <Suspense fallback={<div className="min-h-[50vh] py-6 text-sm text-muted-foreground">正在加载扫描历史…</div>}>
        <ScanHistoryManagement />
      </Suspense>
    </AdminWorkbench>
  )
}
