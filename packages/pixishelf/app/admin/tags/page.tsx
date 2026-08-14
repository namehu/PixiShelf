import TagManagement from './_components/tag-management'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata = {
  title: '标签管理 - PixiShelf Admin'
}

export default function TagsPage() {
  return (
    <AdminWorkbench title="标签管理" description="维护标签翻译、使用统计与系统标签。">
      <TagManagement />
    </AdminWorkbench>
  )
}
