import type { Metadata } from 'next'
import { AdminWorkbench } from '@/app/admin/_components/admin-workbench'
import {
  SourceAuditBackLink,
  SourceAuditManagement
} from '@/app/admin/scan-history/_components/source-audit-management'

export const metadata: Metadata = {
  title: '来源一致性核对 - PixiShelf Admin',
  description: '查看 Pixiv metadata 来源差异，并安全同步经管理员确认的项目'
}

export default async function SourceAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <AdminWorkbench
      eyebrow="扫描历史"
      title="来源一致性核对"
      description="核对结果本身只读；只有管理员确认所选的“新增”或“变化”项目后才会同步来源。“来源缺失”不会删除作品或解除关联。"
      actions={<SourceAuditBackLink />}
    >
      <SourceAuditManagement auditRunId={id} />
    </AdminWorkbench>
  )
}
