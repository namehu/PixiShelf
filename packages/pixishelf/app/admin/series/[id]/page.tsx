
'use client'
import { useParams } from 'next/navigation'
import SeriesDetailAdmin from './_components/series-detail-admin'
import { AdminWorkbench } from '../../_components/admin-workbench'
import { PageState } from '@/components/layout/page-state'

export default function Page() {
  const params = useParams()
  const id = Number(params.id)
  if (isNaN(id)) {
    return (
      <AdminWorkbench title="系列详情" description="管理系列内作品和显示顺序。">
        <PageState variant="error" title="无效的系列 ID" description="请从系列管理列表重新进入。" compact />
      </AdminWorkbench>
    )
  }
  return <SeriesDetailAdmin seriesId={id} />
}
