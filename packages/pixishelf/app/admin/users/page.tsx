import UserManagement from './_components/user-management'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata = {
  title: '用户管理 - PixiShelf Admin'
}

export default function UsersPage() {
  return (
    <AdminWorkbench title="用户管理" description="管理可访问 PixiShelf 的用户账户。">
      <UserManagement />
    </AdminWorkbench>
  )
}
