'use client'

import { Dispatch, SetStateAction } from 'react'
import { BarChart3, ChevronDown, Download, FileText, FolderInput, Plus, Sliders } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SDropdown } from '@/components/shared/s-dropdown'
import type { MigrationSafety } from './artwork-management-types'

interface ArtworkManagementToolbarProps {
  migrationSafety: MigrationSafety
  setMigrationSafety: Dispatch<SetStateAction<MigrationSafety>>
  isExporting: boolean
  selectedCount: number
  migrationState: {
    migrating: boolean
  }
  hasMigrationLogs: boolean
  onCreate: () => void
  onBatchImport: () => void
  onExportNoSeries: () => void
  onMigrationClick: () => void
  onOpenLogs: () => void
}

export function ArtworkManagementToolbar({
  migrationSafety,
  setMigrationSafety,
  isExporting,
  selectedCount,
  migrationState,
  hasMigrationLogs,
  onCreate,
  onBatchImport,
  onExportNoSeries,
  onMigrationClick,
  onOpenLogs
}: ArtworkManagementToolbarProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-neutral-200 pb-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-neutral-900 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 md:w-6 md:h-6" />
          作品管理
        </h1>
        <p className="text-sm md:text-base text-neutral-600 mt-1">管理作品，支持搜索、筛选和批量操作</p>
      </div>
      <div className="flex gap-2 w-full md:w-auto">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <Sliders className="w-4 h-4" />
              迁移策略
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="end">
            <div className="space-y-3">
              <div className="text-sm font-medium text-neutral-800">传输方式</div>
              <Select
                value={migrationSafety.transferMode}
                onValueChange={(value) =>
                  setMigrationSafety((prev) => ({
                    ...prev,
                    transferMode: value as 'move' | 'copy'
                  }))
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="选择方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="move">移动</SelectItem>
                  <SelectItem value="copy">复制</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={migrationSafety.verifyAfterCopy}
                  onCheckedChange={(value) =>
                    setMigrationSafety((prev) => ({
                      ...prev,
                      verifyAfterCopy: !!value
                    }))
                  }
                  disabled={migrationSafety.transferMode !== 'copy'}
                />
                <span className="text-sm text-neutral-700">复制后校验</span>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={migrationSafety.cleanupSource}
                  onCheckedChange={(value) =>
                    setMigrationSafety((prev) => ({
                      ...prev,
                      cleanupSource: !!value
                    }))
                  }
                />
                <span className="text-sm text-neutral-700">清理源文件</span>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Button key="create" variant="default" size="sm" className="gap-2" onClick={onCreate}>
          <Plus className="w-4 h-4" />
          新增作品
        </Button>

        <SDropdown
          menu={{
            items: [
              {
                key: 'batchImport',
                icon: <Plus className="w-4 h-4" />,
                label: '批量导入',
                onClick: onBatchImport
              },
              {
                key: 'export',
                icon: <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />,
                label: isExporting ? '导出中...' : '导出无系列ID',
                disabled: isExporting,
                onClick: onExportNoSeries
              },
              {
                key: 'migrate',
                icon: migrationState.migrating ? (
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                ) : (
                  <FolderInput className="w-4 h-4" />
                ),
                label: migrationState.migrating
                  ? '迁移中...'
                  : selectedCount > 0
                    ? `批量迁移 (${selectedCount})`
                    : '目录迁移',
                disabled: migrationState.migrating,
                onClick: onMigrationClick
              },
              {
                key: 'log-separator',
                type: 'divider',
                hidden: !(migrationState.migrating || hasMigrationLogs)
              },
              {
                key: 'logs',
                icon: <FileText className="w-4 h-4" />,
                label: '查看日志',
                hidden: !(migrationState.migrating || hasMigrationLogs),
                onClick: onOpenLogs
              }
            ]
          }}
        >
          <Button variant="outline" size="sm" className="flex items-center gap-2">
            更多操作
            <ChevronDown className="w-4 h-4" />
          </Button>
        </SDropdown>
      </div>
    </div>
  )
}
