import { Metadata } from 'next'
import { ArtistManagement } from './_components/artist-management'
import { ArtistExportButton } from './_components/artist-export-button'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata: Metadata = {
  title: '艺术家管理 - PixiShelf Admin',
  description: '管理系统中的艺术家信息'
}

export default function ArtistPage() {
  return (
    <AdminWorkbench
      title="艺术家管理"
      description="查看和维护艺术家资料、星标状态与作品关联。"
      actions={<ArtistExportButton />}
    >
      <ArtistManagement />
    </AdminWorkbench>
  )
}
