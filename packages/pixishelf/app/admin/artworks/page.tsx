import ArtworkManagement from './_components/artwork-management'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata = {
  title: '作品管理 - PixiShelf Admin'
}

export default function ArtworksPage() {
  return (
    <AdminWorkbench title="作品管理" description="搜索、筛选并维护作品信息与媒体文件。">
      <ArtworkManagement />
    </AdminWorkbench>
  )
}
