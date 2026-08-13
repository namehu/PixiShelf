import { Metadata } from 'next'
import { Suspense } from 'react'
import { ScanHistoryManagement } from './_components/scan-history-management'

export const metadata: Metadata = {
  title: '扫描历史 - PixiShelf Admin',
  description: '查看扫描运行记录与作品级处理明细'
}

export default function ScanHistoryPage() {
  return (
    <Suspense fallback={<div className="min-h-[50vh] p-6 text-sm text-muted-foreground">正在加载扫描历史…</div>}>
      <ScanHistoryManagement />
    </Suspense>
  )
}
