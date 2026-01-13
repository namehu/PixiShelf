import ScanManagement from './_components/scan-management'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: '设置管理 - PixiShelf Admin',
  description: '扫描设置与系统配置'
}

export default function SettingPage() {
  return <ScanManagement />
}
