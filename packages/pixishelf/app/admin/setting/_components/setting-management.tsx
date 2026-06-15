'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ScanManagement from './scan-management'
import { SystemSettingsPanel } from './system-settings-panel'
import LocalDirectoryImportManagement from './local-directory-import-management'

export function SettingManagement() {
  return (
    <Tabs defaultValue="scan" className="min-h-full">
      <div className="border-b bg-white/70 px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">设置管理</h1>
            <p className="text-sm text-neutral-500">管理扫描配置和系统级默认行为</p>
          </div>
          <TabsList>
            <TabsTrigger value="scan">Pixiv 扫描</TabsTrigger>
            <TabsTrigger value="local-import">本地目录导入</TabsTrigger>
            <TabsTrigger value="system">系统设置</TabsTrigger>
          </TabsList>
        </div>
      </div>

      <TabsContent value="scan" className="m-0">
        <ScanManagement />
      </TabsContent>
      <TabsContent value="local-import" className="m-0">
        <LocalDirectoryImportManagement />
      </TabsContent>
      <TabsContent value="system" className="m-0">
        <SystemSettingsPanel />
      </TabsContent>
    </Tabs>
  )
}
