'use client'

import { Dispatch, SetStateAction } from 'react'
import { ChevronDown, Copy, Download, FileText, FolderInput, FolderSync, Plus, Sliders } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  pendingReplaceCopyMode: boolean
  onCreate: () => void
  onBatchImport: () => void
  onBatchReplace: () => void
  onExportNoSeries: () => void
  onMigrationClick: () => void
  onOpenLogs: () => void
  onTogglePendingReplaceCopyMode: () => void
}

export function ArtworkManagementToolbar({
  migrationSafety,
  setMigrationSafety,
  isExporting,
  selectedCount,
  migrationState,
  hasMigrationLogs,
  pendingReplaceCopyMode,
  onCreate,
  onBatchImport,
  onBatchReplace,
  onExportNoSeries,
  onMigrationClick,
  onOpenLogs,
  onTogglePendingReplaceCopyMode
}: ArtworkManagementToolbarProps) {
  return (
    <div className="flex w-full flex-wrap justify-end gap-2 border-b border-border pb-4" role="toolbar" aria-label="作品管理操作">
        <Button
          variant={pendingReplaceCopyMode ? 'secondary' : 'outline'}
          size="sm"
          className="min-w-0 flex-1 gap-2 sm:flex-none"
          onClick={onTogglePendingReplaceCopyMode}
          title="开启后复制作品 externalId 将得到 __ext-{externalId}"
          aria-pressed={pendingReplaceCopyMode}
        >
          <Copy data-icon="inline-start" aria-hidden="true" />
          {pendingReplaceCopyMode ? '替换后缀复制中' : '复制替换后缀'}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="flex flex-1 items-center gap-2 sm:flex-none">
              <Sliders data-icon="inline-start" aria-hidden="true" />
              迁移策略
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="end">
            <div className="flex flex-col gap-3">
              <div className="text-sm font-medium text-foreground">传输方式</div>
              <Select
                value={migrationSafety.transferMode}
                onValueChange={(value) =>
                  setMigrationSafety((prev) => ({
                    ...prev,
                    transferMode: value as 'move' | 'copy'
                  }))
                }
              >
                <SelectTrigger className="h-8" aria-label="迁移传输方式">
                  <SelectValue placeholder="选择方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="move">移动</SelectItem>
                    <SelectItem value="copy">复制</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <label className="flex cursor-pointer items-center gap-2">
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
                <span className="text-sm text-foreground">复制后校验</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={migrationSafety.cleanupSource}
                  onCheckedChange={(value) =>
                    setMigrationSafety((prev) => ({
                      ...prev,
                      cleanupSource: !!value
                    }))
                  }
                />
                <span className="text-sm text-foreground">清理源文件</span>
              </label>
            </div>
          </PopoverContent>
        </Popover>
        <Button key="create" variant="default" size="sm" className="flex-1 gap-2 sm:flex-none" onClick={onCreate}>
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
                key: 'batchReplace',
                icon: <FolderSync className="w-4 h-4" />,
                label: '批量替换媒体',
                onClick: onBatchReplace
              },
              {
                key: 'export',
                icon: <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />,
                label: isExporting ? '导出中…' : '导出无系列 ID',
                disabled: isExporting,
                onClick: onExportNoSeries
              },
              {
                key: 'migrate',
                icon: migrationState.migrating ? (
                  <span className="size-2 animate-pulse rounded-full bg-success" />
                ) : (
                  <FolderInput className="w-4 h-4" />
                ),
                label: migrationState.migrating
                  ? '迁移中…'
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
          <Button variant="outline" size="sm" className="flex flex-1 items-center gap-2 sm:flex-none">
            更多操作
            <ChevronDown className="w-4 h-4" />
          </Button>
        </SDropdown>
    </div>
  )
}
