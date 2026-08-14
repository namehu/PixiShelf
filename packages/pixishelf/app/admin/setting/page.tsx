import { Metadata } from 'next'
import { SettingManagement } from './_components/setting-management'
import { AdminWorkbench } from '../_components/admin-workbench'

export const metadata: Metadata = {
  title: '设置管理 - PixiShelf Admin',
  description: '扫描设置与系统配置'
}

export default function SettingPage() {
  return (
    <AdminWorkbench title="扫描与系统设置" description="配置 Pixiv 扫描、本地导入与系统级默认行为。">
      <SettingManagement />
    </AdminWorkbench>
  )
}
