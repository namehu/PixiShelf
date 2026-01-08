import { Metadata } from 'next'
import AdminLayout from './_components/admin-layout'

export const metadata: Metadata = {
  title: 'PixiShelf 管理后台',
  description: '管理用户、标签和扫描任务'
}

export default function AdminPage() {
  return <AdminLayout />
}
