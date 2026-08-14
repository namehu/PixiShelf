
import SeriesManagement from './_components/series-management'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata = {
  title: '系列管理 - PixiShelf Admin'
}

export default function SeriesPage() {
  return (
    <AdminWorkbench title="系列管理" description="组织系列档案，并调整系列内作品。">
      <SeriesManagement />
    </AdminWorkbench>
  )
}
