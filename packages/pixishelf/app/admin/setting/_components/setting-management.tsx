'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ScanManagement from './scan-management'
import { SystemSettingsPanel } from './system-settings-panel'
import LocalDirectoryImportManagement from './local-directory-import-management'

export function SettingManagement() {
  return (
    <Tabs defaultValue="scan" className="min-h-full min-w-0">
      <div className="overflow-x-auto border-b border-border pb-3">
          <TabsList className="w-max min-w-full justify-start sm:min-w-0">
            <TabsTrigger value="scan">Pixiv 扫描</TabsTrigger>
            <TabsTrigger value="local-import">本地目录导入</TabsTrigger>
            <TabsTrigger value="system">系统设置</TabsTrigger>
          </TabsList>
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
