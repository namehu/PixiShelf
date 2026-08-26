'use client'

import { Dispatch, SetStateAction } from 'react'
import { ChevronDown, Copy, Download, FileText, FolderInput, FolderSync, Plus, Sliders, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
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
  selectedPixivCount: number
  onPixivSync: () => void
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
  onTogglePendingReplaceCopyMode,
  selectedPixivCount,
  onPixivSync
}: ArtworkManagementToolbarProps) {
  const transferModeLabel = migrationSafety.transferMode === 'move' ? '移动' : '复制'

  return (
    <div className="flex w-full justify-end gap-2 sm:w-auto" role="toolbar" aria-label="作品管理操作">
      <Button variant="default" size="sm" className="flex-1 sm:flex-none" onClick={onCreate}>
        <Plus data-icon="inline-start" aria-hidden="true" />
        新增作品
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="flex-1 sm:flex-none"
        onClick={onPixivSync}
        disabled={selectedCount > 0 && selectedPixivCount === 0}
      >
        <Sparkles data-icon="inline-start" aria-hidden="true" />
        {selectedPixivCount
          ? `同步已选 ${selectedPixivCount} 项`
          : selectedCount > 0
            ? '所选无可同步作品'
            : '从 Pixiv 同步'}
      </Button>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="flex-1 sm:flex-none">
            更多操作
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>内容维护</DropdownMenuLabel>
            <DropdownMenuItem onSelect={onBatchImport}>
              <Plus aria-hidden="true" />
              批量导入
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onBatchReplace}>
              <FolderSync aria-hidden="true" />
              批量替换媒体
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isExporting} onSelect={onExportNoSeries}>
              {isExporting ? <Spinner aria-hidden="true" /> : <Download aria-hidden="true" />}
              {isExporting ? '导出中…' : '导出无系列 ID'}
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel>目录迁移</DropdownMenuLabel>
            <DropdownMenuItem disabled={migrationState.migrating} onSelect={onMigrationClick}>
              {migrationState.migrating ? <Spinner aria-hidden="true" /> : <FolderInput aria-hidden="true" />}
              {migrationState.migrating
                ? '迁移中…'
                : selectedCount > 0
                  ? `迁移已选作品（${selectedCount}）`
                  : '开始目录迁移'}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Sliders aria-hidden="true" />
                迁移策略：{transferModeLabel}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>传输方式</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={migrationSafety.transferMode}
                    onValueChange={(value) =>
                      setMigrationSafety((previous) => ({
                        ...previous,
                        transferMode: value as 'move' | 'copy'
                      }))
                    }
                  >
                    <DropdownMenuRadioItem value="move">移动文件</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="copy">复制文件</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuCheckboxItem
                    checked={migrationSafety.verifyAfterCopy}
                    disabled={migrationSafety.transferMode !== 'copy'}
                    onCheckedChange={(checked) =>
                      setMigrationSafety((previous) => ({
                        ...previous,
                        verifyAfterCopy: checked
                      }))
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    复制后校验
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={migrationSafety.cleanupSource}
                    onCheckedChange={(checked) =>
                      setMigrationSafety((previous) => ({
                        ...previous,
                        cleanupSource: checked
                      }))
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    清理源文件
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {(migrationState.migrating || hasMigrationLogs) && (
              <DropdownMenuItem onSelect={onOpenLogs}>
                <FileText aria-hidden="true" />
                查看迁移日志
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel>复制设置</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={pendingReplaceCopyMode}
              onCheckedChange={onTogglePendingReplaceCopyMode}
              onSelect={(event) => event.preventDefault()}
            >
              <Copy aria-hidden="true" />
              复制 ID 时添加替换后缀
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
