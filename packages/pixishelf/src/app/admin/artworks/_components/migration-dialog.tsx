import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FolderInput, StopCircle } from 'lucide-react'
import { LogViewer } from '@/components/shared/log-viewer'
import { useMigration } from '../_hooks/use-migration'

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
      <DialogContent className="sm:max-w-5xl h-[80vh] flex flex-col p-0 gap-0 bg-[#1e1e1e] border-neutral-800">
        <DialogHeader className="p-4 border-b border-white/10 bg-neutral-900">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-neutral-200 flex items-center gap-2 text-sm font-mono">
              <FolderInput className="w-4 h-4" />
              MIGRATION_CONSOLE
              {migrationState.migrating && (
                <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 ml-2 animate-pulse">
                  RUNNING
                </span>
              )}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {migrationState.migrating && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={migrationActions.cancelMigration}
                >
                  <StopCircle className="w-3 h-3 mr-1" />
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
            loading={migrationState.migrating}
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
