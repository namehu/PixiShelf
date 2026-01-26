'use client'
import { useState } from 'react'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Edit, Trash, ExternalLink, Download } from 'lucide-react'
import { ArtworkDialog } from './artwork-dialog'
import { useDebounce } from '@/hooks/useDebounce'
import { toast } from 'sonner'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { exportNoSeriesArtworksAction } from '@/actions/artwork-action'
import { LogViewer } from '@/components/shared/log-viewer'
import { useMigration } from '../_hooks/use-migration'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FolderInput, Play, StopCircle, RotateCcw } from 'lucide-react'

export default function ArtworkManagement() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 500)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingArtwork, setEditingArtwork] = useState<any>(null)
  const [isExporting, setIsExporting] = useState(false)

  // Migration Hook
  const { state: migrationState, actions: migrationActions, logger: migrationLogger } = useMigration()
  const [logOpen, setLogOpen] = useState(false)

  const { data, isLoading } = useQuery(
    trpc.artwork.list.queryOptions({
      cursor: page,
      pageSize: 20,
      search: debouncedQuery
    })
  )

  const deleteMutation = useMutation(
    trpc.artwork.delete.mutationOptions({
      onSuccess: () => {
        toast.success('删除成功')
        queryClient.invalidateQueries({ queryKey: trpc.artwork.list.queryKey() })
      }
    })
  )

  const handleExportNoSeries = async () => {
    try {
      setIsExporting(true)
      const res = await exportNoSeriesArtworksAction()

      if (!res.success || !res.data) {
        toast.error('导出失败: ' + (res.error || '未知错误'))
        return
      }

      const ids = res.data

      if (ids.length === 0) {
        toast.info('没有找到无系列的作品')
        return
      }

      const content = ids.join('\n')
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `no-series-artworks-${new Date().toISOString().split('T')[0]}.txt`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success(`成功导出 ${ids.length} 个作品ID`)
    } catch (error) {
      toast.error('导出失败')
    } finally {
      setIsExporting(false)
    }
  }

  const handleDelete = (id: number) => {
    if (confirm('确定删除该作品吗？')) {
      deleteMutation.mutate(id)
    }
  }

  const handleEdit = (item: any) => {
    setEditingArtwork(item)
    setDialogOpen(true)
  }

  // --- Migration Handlers ---
  const handleFullMigration = () => {
    setLogOpen(true)
    migrationActions.startMigration()
  }

  const handleSingleMigration = (id: number) => {
    setLogOpen(true)
    migrationActions.startMigration({ targetIds: [id] })
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">作品管理</h2>
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            onClick={handleFullMigration}
            disabled={migrationState.migrating}
          >
            {migrationState.migrating ? (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                迁移中...
              </span>
            ) : (
              <>
                <FolderInput className="w-4 h-4" />
                结构化迁移
              </>
            )}
          </Button>

          {/* 只有在迁移中或有日志时才显示日志按钮 */}
          {(migrationState.migrating || migrationLogger.logs.length > 0) && (
            <Button variant="ghost" size="sm" onClick={() => setLogOpen(true)}>
              查看日志
            </Button>
          )}
        </div>

        <Button
          variant="outline"
          onClick={handleExportNoSeries}
          disabled={isExporting}
          className="flex items-center gap-2"
        >
          <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
          {isExporting ? '导出中...' : '导出无系列ID'}
        </Button>
      </div>

      <div className="flex gap-4">
        <Input
          placeholder="搜索作品..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>标题</TableHead>
              <TableHead>路径</TableHead>
              <TableHead>作者</TableHead>
              <TableHead>图片数</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  加载中...
                </TableCell>
              </TableRow>
            ) : (
              data?.items.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link href={`/artwork/${item.id}`} className="hover:underline font-medium" target="_blank">
                      {item.title}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={item.firstImagePath}>
                    <span className="font-mono text-xs text-neutral-400">{item.firstImagePath || '-'}</span>
                  </TableCell>
                  <TableCell>{item.artist?.name || '未知'}</TableCell>
                  <TableCell>{item.imageCount}</TableCell>
                  <TableCell>{item.createdAt}</TableCell>
                  <TableCell className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(item)} title="编辑">
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleSingleMigration(item.id)}
                      title="执行文件结构迁移"
                      disabled={migrationState.migrating}
                    >
                      <FolderInput className="w-4 h-4 text-blue-500" />
                    </Button>
                    <Link href={`/artwork/${item.id}`} target="_blank">
                      <Button variant="ghost" size="icon" title="新标签页打开">
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-500"
                      onClick={() => handleDelete(item.id)}
                      title="删除"
                    >
                      <Trash className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
            {!isLoading && (!data?.items || data.items.length === 0) && (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  暂无数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ArtworkDialog open={dialogOpen} onOpenChange={setDialogOpen} artwork={editingArtwork} onSuccess={() => {}} />

      {/* 迁移日志弹窗 */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0 bg-[#1e1e1e] border-neutral-800">
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
    </div>
  )
}
