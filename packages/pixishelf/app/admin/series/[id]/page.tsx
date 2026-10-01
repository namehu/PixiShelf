'use client'
import { useParams } from 'next/navigation'
import SeriesManagement from '../_components/series-management'
import { AdminWorkbench } from '../../_components/admin-workbench'
import { PageState } from '@/components/layout/page-state'

export default function Page() {
  const params = useParams()
  const id = Number(params.id)
  if (!Number.isSafeInteger(id) || id < 1) {
    return (
      <AdminWorkbench title="系列详情" description="管理系列内作品和显示顺序。">
        <PageState variant="error" title="无效的系列 ID" description="请从系列管理列表重新进入。" compact />
      </AdminWorkbench>
    )
  }
  return <SeriesManagement initialSeriesId={id} />
}
