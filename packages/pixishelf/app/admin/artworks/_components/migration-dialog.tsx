import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FolderInput, StopCircle, PauseCircle, PlayCircle, Download } from 'lucide-react'
import { LogViewer } from '@/components/shared/log-viewer'
import { useMigration } from '../_hooks/use-migration'
import { confirm } from '@/components/shared/global-confirm'

interface MigrationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  migrationState: ReturnType<typeof useMigration>['state']
  migrationActions: ReturnType<typeof useMigration>['actions']
  migrationLogger: ReturnType<typeof useMigration>['logger']
}

export function MigrationDialog({
  open,
  onOpenChange,
  migrationState,
  migrationActions,
  migrationLogger
}: MigrationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90dvh,52rem)] flex-col gap-0 border-neutral-800 bg-[#1e1e1e] p-0 sm:max-w-5xl">
        <DialogHeader className="p-4 border-b border-white/10 bg-neutral-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <DialogTitle className="text-neutral-200 flex items-center gap-2 text-sm font-mono">
              <FolderInput className="size-4" aria-hidden="true" />
              MIGRATION_CONSOLE
              {migrationState.migrating && !migrationState.paused && (
                <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 ml-2 animate-pulse">
                  RUNNING
                </span>
              )}
              {migrationState.migrating && migrationState.paused && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 ml-2">PAUSED</span>
              )}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {!migrationState.migrating && (migrationState.stats?.failed || 0) > 0 && (
                <>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={migrationActions.exportFailed}>
                    <Download data-icon="inline-start" aria-hidden="true" />
                    失败清单
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={migrationActions.retryFailed}>
                    <PlayCircle data-icon="inline-start" aria-hidden="true" />
                    失败重试
                  </Button>
                </>
              )}
              {migrationState.migrating && !migrationState.paused && (
                <Button size="sm" className="h-7 text-xs" onClick={migrationActions.pauseMigration}>
                  <PauseCircle data-icon="inline-start" aria-hidden="true" />
                  暂停
                </Button>
              )}
              {migrationState.migrating && migrationState.paused && (
                <Button size="sm" className="h-7 text-xs" onClick={migrationActions.resumeMigration}>
                  <PlayCircle data-icon="inline-start" aria-hidden="true" />
                  继续
                </Button>
              )}
              {migrationState.migrating && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    confirm({
                      title: '中止当前文件迁移？',
                      description: '尚未处理的文件会停止迁移，已经完成的文件不会自动撤销。',
                      confirmText: '确认中止',
                      variant: 'destructive',
                      onConfirm: migrationActions.cancelMigration
                    })
                  }
                >
                  <StopCircle data-icon="inline-start" aria-hidden="true" />
                  中止
                </Button>
              )}
            </div>
          </div>
          <DialogDescription className="hidden">文件迁移日志控制台</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden relative">
          <LogViewer
            logs={migrationLogger.logs}
            onClear={migrationActions.clearLogs}
            height="100%"
            className="border-0 rounded-none h-full"
            loading={migrationState.migrating && !migrationState.paused}
          />
        </div>

        {/* 底部状态栏 */}
        <div className="h-8 bg-neutral-900 border-t border-white/10 flex items-center px-4 text-[10px] font-mono text-neutral-500 gap-4">
          {migrationState.stats && (
            <>
              <span>TOTAL: {migrationState.stats.total}</span>
              <span className="text-green-500">SUCCESS: {migrationState.stats.success}</span>
              <span className="text-blue-500">SKIPPED: {migrationState.stats.skipped}</span>
              <span className="text-red-500">FAILED: {migrationState.stats.failed}</span>
              <span className="ml-auto text-neutral-400">{migrationState.currentMessage}</span>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
