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
import { exportNoSeriesArtworksAction } from '@/actions/artwork-action'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMigration } from '../_hooks/use-migration'
import { MigrationDialog } from './migration-dialog'
import { FolderInput } from 'lucide-react'
import { confirm } from '@/components/shared/global-confirm'

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
    confirm({
      title: '确定删除该作品吗？',
      onConfirm: () => {
        deleteMutation.mutate(id)
      }
    })
  }

  const handleEdit = (item: any) => {
    setEditingArtwork(item)
    setDialogOpen(true)
  }

  // --- Migration Handlers ---
  const handleFullMigrationClick = () => {
    confirm({
      title: '确认执行全量迁移？',
      description: (
        <div className="text-sm text-neutral-400 mt-2 space-y-2">
          <div>此操作将扫描所有作品，并尝试将其文件移动到标准化的目录结构中。</div>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>涉及大量文件移动，可能需要较长时间。</li>
            <li>建议在执行前备份数据。</li>
            <li>迁移过程中请勿关闭浏览器窗口。</li>
          </ul>
        </div>
      ),
      confirmText: '确认开始',
      onConfirm: () => {
        setLogOpen(true)
        migrationActions.startMigration()
      }
    })
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
            onClick={handleFullMigrationClick}
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
      <MigrationDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        migrationState={migrationState}
        migrationActions={migrationActions}
        migrationLogger={migrationLogger}
      />
    </div>
  )
}
