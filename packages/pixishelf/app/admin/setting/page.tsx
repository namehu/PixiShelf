import { Metadata } from 'next'
import { SettingManagement } from './_components/setting-management'

export const metadata: Metadata = {
  title: '设置管理 - PixiShelf Admin',
  description: '扫描设置与系统配置'
}

export default function SettingPage() {
  return <SettingManagement />
}
