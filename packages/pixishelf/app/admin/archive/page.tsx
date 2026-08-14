import { ArchiveManagement } from './_components/archive-management'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata = {
  title: '链接归档 - PixiShelf Admin'
}

export default function ArchivePage() {
  return (
    <AdminWorkbench title="链接归档" description="从外部作品链接下载、追踪并归档内容。">
      <ArchiveManagement />
    </AdminWorkbench>
  )
}
