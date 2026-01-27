import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTRPCClient } from '@/lib/trpc'
import { Loader2, AlertTriangle, CheckCircle, XCircle, FolderInput, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { ProTable } from '@/components/shared/pro-table'
import { ColumnDef } from '@tanstack/react-table'
import { MEDIA_EXTENSIONS } from '../../../../../lib/constant'
import { extractOrderFromName } from '@/utils/artwork/extract-order-from-name'
import { formatFileSize } from '@/utils/media'

interface ImageManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artworkId: number | null
  firstImagePath?: string // 用于定位目录
  onSuccess?: () => void
}

type UploadStatus = 'idle' | 'backup' | 'uploading' | 'syncing' | 'success' | 'error'

interface PreviewItem {
  file: File
  originalName: string
  newName: string
  order: number
  size: number
  error?: string
}

// 图片列表项接口
interface ImageListItem {
  id: number
  path: string
  sortOrder: number
  width: number | null
  height: number | null
  size: number | null
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const result = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

export function ImageManagerDialog({
  open,
  onOpenChange,
  artworkId,
  firstImagePath,
  onSuccess
}: ImageManagerDialogProps) {
  const trpcClient = useTRPCClient()
  const [activeTab, setActiveTab] = useState('list')
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [files, setFiles] = useState<File[]>([])
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [imageList, setImageList] = useState<ImageListItem[]>([])
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 })

  const [artwork, setArtwork] = useState<{ title?: string; externalId?: string }>({})

  const fetchArtworkData = useCallback(() => {
    if (!artworkId) return
    trpcClient.artwork.getById.query(artworkId).then((res) => {
      if (res) {
        setArtwork({ title: res.title, externalId: res.externalId || undefined })
        setImageList((res.images || []) as unknown as ImageListItem[])
      }
    })
  }, [artworkId, trpcClient])

  // 当 Dialog 打开时刷新
  useEffect(() => {
    if (open && artworkId) {
      setRefreshKey((prev) => prev + 1)
      setUploadStatus('idle')
      setFiles([])
      setPreviewItems([])
      setUploadProgress(0)
      setImageList([])
      setBatchProgress({ current: 0, total: 0 })

      fetchArtworkData()
    }
  }, [open, artworkId, fetchArtworkData])

  // ProTable 列定义
  const columns: ColumnDef<ImageListItem>[] = [
    {
      header: 'Order',
      accessorKey: 'sortOrder',
      size: 80
    },
    {
      header: '路径 / 文件名',
      accessorKey: 'path',
      cell: ({ getValue }) => {
        const val = getValue<string>()
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">{val.split('/').pop()}</span>
            <span className="text-[10px] text-neutral-400 truncate max-w-[300px]" title={val}>
              {val}
            </span>
          </div>
        )
      }
    },
    {
      header: '尺寸',
      accessorKey: 'width', // Use width as key, but render combined
      size: 100,
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.width && row.original.height ? `${row.original.width}x${row.original.height}` : '-'}
        </span>
      )
    },
    {
      header: '大小',
      accessorKey: 'size',
      size: 100,
      cell: ({ getValue }) => (
        <span className="text-xs text-neutral-500 block text-right">{formatFileSize(getValue<number>() || 0)}</span>
      )
    }
  ]

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files)
      // 过滤掉非媒体文件
      const validFiles = selectedFiles.filter((f) => MEDIA_EXTENSIONS.includes('.' + (f.name.split('.').pop() || '')))

      setFiles(validFiles)
      generatePreview(validFiles)
    }
  }

  // 生成预览数据
  const generatePreview = (fileList: File[]) => {
    const items: PreviewItem[] = fileList.map((file) => {
      const order = extractOrderFromName(file.name)
      const ext = file.name.split('.').pop()
      const newName = `${artwork.externalId}_p${order}.${ext}`

      return {
        file,
        originalName: file.name,
        newName,
        order,
        size: file.size
      }
    })

    // 检查 Order 冲突
    const orderCounts = new Map<number, number>()
    items.forEach((item) => {
      orderCounts.set(item.order, (orderCounts.get(item.order) || 0) + 1)
    })

    const itemsWithValidation = items.map((item) => ({
      ...item,
      error: orderCounts.get(item.order)! > 1 ? '排序序号冲突' : undefined
    }))

    // 按 Order 排序
    itemsWithValidation.sort((a, b) => a.order - b.order)

    setPreviewItems(itemsWithValidation)
  }

  // 处理手动修改 Order
  const handleOrderChange = (index: number, newOrder: number) => {
    const newItems = [...previewItems]
    const item = newItems[index]

    if (!item) return

    item.order = newOrder
    const ext = item.file.name.split('.').pop()
    item.newName = `${artwork.externalId}_p${newOrder}.${ext}`

    // 重新校验冲突
    const orderCounts = new Map<number, number>()
    newItems.forEach((item) => {
      orderCounts.set(item.order, (orderCounts.get(item.order) || 0) + 1)
    })

    const validatedItems = newItems.map((item) => ({
      ...item,
      error: orderCounts.get(item.order)! > 1 ? '排序序号冲突' : undefined
    }))

    setPreviewItems(validatedItems)
  }

  // 执行全量替换
  const handleReplace = async () => {
    if (!artworkId || files.length === 0) return

    if (previewItems.some((i) => i.error)) {
      toast.error('存在序号冲突，请先修正')
      return
    }

    // 这里不再强制 firstImagePath，因为后端有 fallback 策略
    // if (!firstImagePath) { ... }

    setUploadStatus('backup')
    setUploadProgress(0)

    try {
      // 1. 发起初始化 (备份)
      const initRes = await fetch(`/api/artwork/${artworkId}/replace?action=init`, { method: 'POST' })
      if (!initRes.ok) throw new Error('初始化备份失败')

      setUploadStatus('uploading')

      // 2. 准备分批上传
      // 建议每批次 5-10 个文件，或者根据总大小动态计算
      const BATCH_SIZE = 5
      const fileChunks = chunkArray(files, BATCH_SIZE)
      const totalBatches = fileChunks.length

      const allUploadedMeta: any[] = []

      for (let i = 0; i < totalBatches; i++) {
        const chunk = fileChunks[i]!
        setBatchProgress({ current: i + 1, total: totalBatches }) // 更新批次进度
        setUploadProgress(Math.round((i / totalBatches) * 100))

        const formData = new FormData()

        // 构建当前批次的 FormData
        chunk.forEach((file) => {
          const item = previewItems.find((p) => p.originalName === file.name && p.size === file.size)
          const nameToSend = item ? item.newName : file.name
          // 这里必须使用 rename 后的文件
          formData.append('files', new File([file], nameToSend, { type: file.type }))
        })

        // 上传当前批次
        const res = await fetch(`/api/artwork/${artworkId}/replace?action=upload`, {
          method: 'POST',
          body: formData
          // fetch 自动处理 multipart headers，不需要手动设置
        })

        if (!res.ok) throw new Error(`批次 ${i + 1} 上传失败`)

        const json = await res.json()
        if (json.meta) {
          allUploadedMeta.push(...json.meta)
        }
      }

      setUploadProgress(100)

      // 3. 提交事务 (Commit)
      setUploadStatus('syncing')
      const commitRes = await fetch(`/api/artwork/${artworkId}/replace?action=commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filesMeta: allUploadedMeta })
      })

      if (!commitRes.ok) throw new Error('数据库同步失败')

      setUploadStatus('success')
      toast.success('全量替换成功')
      onSuccess?.()
      setRefreshKey((p) => p + 1)
      fetchArtworkData()

      setTimeout(() => {
        setActiveTab('list')
      }, 1500)
    } catch (error: any) {
      console.error(error)
      setUploadStatus('error')
      toast.error(`操作失败: ${error.message}`)

      // 4. 发生错误尝试回滚
      try {
        await fetch(`/api/artwork/${artworkId}/replace?action=rollback`, { method: 'POST' })
        toast.info('已自动回滚至原状态')
      } catch (e) {
        toast.error('回滚失败，请手动检查文件')
      }
    }
  }

  // 渲染列表 Tab
  const renderListTab = () => (
    <div className="h-full flex flex-col">
      <ProTable
        key={refreshKey}
        rowKey="id"
        columns={columns}
        dataSource={imageList}
        defaultPageSize={10}
        toolBarRender={() => (
          <Button
            key="refresh"
            variant="outline"
            size="sm"
            onClick={() => {
              setRefreshKey((k) => k + 1)
              fetchArtworkData()
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </Button>
        )}
      />
    </div>
  )

  // 渲染替换 Tab
  const renderReplaceTab = () => (
    <div className="space-y-4">
      {/* 拖拽/选择区域 */}
      <div className="border-2 border-dashed border-neutral-200 rounded-lg p-6 text-center hover:bg-neutral-50 transition-colors relative">
        <input
          type="file"
          multiple
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onChange={handleFileSelect}
        />
        <div className="flex flex-col items-center gap-2 text-neutral-500">
          <FolderInput className="w-8 h-8 text-neutral-400" />
          <p className="text-sm font-medium">点击选择文件夹 或 拖拽文件到此处</p>
          <p className="text-xs text-neutral-400">支持批量选择，自动解析排序序号</p>
        </div>
      </div>

      {/* 预览列表 */}
      {previewItems.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <div className="bg-neutral-100 px-4 py-2 text-xs font-medium text-neutral-500 flex justify-between items-center">
            <span>待上传: {previewItems.length} 个文件</span>
            <span className="text-neutral-400">
              总大小: {formatFileSize(previewItems.reduce((acc, cur) => acc + cur.size, 0))}
            </span>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-white z-10">
                <TableRow>
                  <TableHead className="w-[80px]">Order</TableHead>
                  <TableHead>原文件名</TableHead>
                  <TableHead>预览新文件名</TableHead>
                  <TableHead className="w-[80px]">状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewItems.map((item, index) => (
                  <TableRow key={index} className={cn(item.error && 'bg-red-50')}>
                    <TableCell>
                      <Input
                        type="number"
                        value={item.order}
                        onChange={(e) => handleOrderChange(index, parseInt(e.target.value) || 0)}
                        className="h-7 w-16 text-center px-1"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-[150px]" title={item.originalName}>
                      {item.originalName}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs text-neutral-500 truncate max-w-[150px]"
                      title={item.newName}
                    >
                      {item.newName}
                    </TableCell>
                    <TableCell>
                      {item.error ? (
                        <span className="text-red-500 text-xs flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          冲突
                        </span>
                      ) : (
                        <span className="text-green-500 text-xs flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          正常
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* 进度条与状态 */}
      {uploadStatus !== 'idle' && (
        <div className="space-y-2 p-4 bg-neutral-50 rounded-lg border border-neutral-100">
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium flex items-center gap-2">
              {uploadStatus === 'backup' && <Loader2 className="w-3 h-3 animate-spin" />}
              {uploadStatus === 'uploading' && <Loader2 className="w-3 h-3 animate-spin" />}
              {uploadStatus === 'syncing' && <RefreshCw className="w-3 h-3 animate-spin" />}
              {uploadStatus === 'success' && <CheckCircle className="w-3 h-3 text-green-500" />}
              {uploadStatus === 'error' && <XCircle className="w-3 h-3 text-red-500" />}

              {uploadStatus === 'backup' && '正在备份旧文件...'}
              {uploadStatus === 'uploading' && `正在分批上传 (${batchProgress.current}/${batchProgress.total})...`}
              {uploadStatus === 'syncing' && '正在同步数据库...'}
              {uploadStatus === 'success' && '全量替换成功！'}
              {uploadStatus === 'error' && '操作失败'}
            </span>
            <span className="text-neutral-500">{Math.round(uploadProgress)}%</span>
          </div>
          <Progress value={uploadProgress} className="h-2" />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={uploadStatus === 'uploading' || uploadStatus === 'syncing'}
        >
          取消
        </Button>
        <Button
          variant="destructive"
          onClick={handleReplace}
          disabled={
            files.length === 0 ||
            uploadStatus === 'uploading' ||
            uploadStatus === 'syncing' ||
            previewItems.some((i) => i.error)
          }
        >
          {uploadStatus === 'uploading' ? '上传中...' : '确认全量替换'}
        </Button>
      </div>
    </div>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (uploadStatus === 'uploading' || uploadStatus === 'syncing') return // 禁止在上传时关闭
        onOpenChange(val)
      }}
    >
      <DialogContent className="sm:max-w-4xl max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            <div>图片管理 - {artwork?.title || '加载中...'}</div>
          </DialogTitle>

          <DialogDescription asChild>
            <div className="flex items-center gap-2">
              <span className="font-medium">{artwork.externalId}</span>
              <span>-</span>
              <span className="text-neutral-500">{firstImagePath}</span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="list">图片列表</TabsTrigger>
            <TabsTrigger value="replace">全量替换</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4 px-1">
            <TabsContent value="list" className="mt-0 h-full">
              {renderListTab()}
            </TabsContent>
            <TabsContent value="replace" className="mt-0 h-full">
              {renderReplaceTab()}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
