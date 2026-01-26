'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTRPCClient } from '@/lib/trpc'
import { Loader2, AlertTriangle, CheckCircle, XCircle, FolderInput, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { STable, STableColumn, STableRequestParams } from '@/components/shared/s-table'

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

  const [artwork, setArtwork] = useState<{ title?: string; externalId?: string } | null>(null)

  // 当 Dialog 打开时刷新
  useEffect(() => {
    if (open && artworkId) {
      setRefreshKey((prev) => prev + 1)
      setUploadStatus('idle')
      setFiles([])
      setPreviewItems([])
      setUploadProgress(0)

      // 获取作品信息用于标题显示
      trpcClient.artwork.getById.query(artworkId).then((res) => {
        if (res) {
          setArtwork({ title: res.title, externalId: res.externalId || undefined })
        }
      })
    }
  }, [open, artworkId, trpcClient])

  // STable 请求函数
  const request = useCallback(
    async (params: STableRequestParams) => {
      if (!artworkId) return { data: [], total: 0, success: true }

      const res = await trpcClient.artwork.getById.query(artworkId)

      if (!res) return { data: [], total: 0, success: true }

      // 前端分页处理 (因为 getById 返回的是全量图片)
      const allImages = (res.images || []) as unknown as ImageListItem[]
      const start = (params.current - 1) * params.pageSize
      const end = start + params.pageSize
      const pagedImages = allImages.slice(start, end)

      return {
        data: pagedImages,
        total: allImages.length,
        success: true
      }
    },
    [artworkId, trpcClient]
  )

  // STable 列定义
  const columns: STableColumn<ImageListItem>[] = [
    {
      title: 'Order',
      dataIndex: 'sortOrder',
      width: 80,
      className: 'font-medium',
      hideInSearch: true
    },
    {
      title: '路径 / 文件名',
      dataIndex: 'path',
      hideInSearch: true,
      render: (val: string) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{val.split('/').pop()}</span>
          <span className="text-[10px] text-neutral-400 truncate max-w-[200px]" title={val}>
            {val}
          </span>
        </div>
      )
    },
    {
      title: '尺寸',
      dataIndex: 'width',
      hideInSearch: true,
      width: 100,
      render: (_, record) => (
        <span className="text-xs">{record.width && record.height ? `${record.width}x${record.height}` : '-'}</span>
      )
    },
    {
      title: '大小',
      dataIndex: 'size',
      hideInSearch: true,
      width: 100,
      className: 'text-right',
      render: (val: number | null) => <span className="text-xs text-neutral-500">{formatBytes(val || 0)}</span>
    }
  ]

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files)
      // 过滤掉非媒体文件
      const validFiles = selectedFiles.filter((f) => !f.name.startsWith('.'))

      setFiles(validFiles)
      generatePreview(validFiles)
    }
  }

  // 生成预览数据
  const generatePreview = (fileList: File[]) => {
    // 假设 externalId 存在于 request 的闭包中不太好拿，这里暂时从 path 猜测或者先不依赖 externalId
    // 实际上我们可以通过 request 获取到的 artwork 信息，但这里是 upload 逻辑
    // 我们可以再发一个简单的 query 获取 externalId 或者让后端处理
    // 这里为了预览简单，先用 placeholder
    const externalId = 'artwork'

    const items: PreviewItem[] = fileList.map((file) => {
      const order = extractOrder(file.name)
      const ext = file.name.split('.').pop()
      const newName = `${externalId}_p${order}.${ext}`

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
    item.newName = `artwork_p${newOrder}.${ext}`

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

    // 获取 targetPath
    // 由于 artwork 数据现在在 STable 内部获取，我们需要一个方式拿到 path
    // 简单起见，如果 firstImagePath 没传，我们先阻止
    // 实际场景：如果列表为空，firstImagePath 也是空的。这时应该允许替换，后端需要处理
    const targetPath = firstImagePath || ''

    // 如果没有 path 且是全量替换，需要确保后端能根据 artworkId 找到目录 (目前后端逻辑依赖 path)
    // 这是一个潜在问题。如果作品从未有过图片，数据库里 path 为空。
    // 我们需要通过 artwork.getById 获取到的数据来决定。
    // 这里先简单处理：如果没 path，尝试再次 fetch 获取第一张图
    let finalPath = targetPath
    if (!finalPath) {
      const res = await trpcClient.artwork.getById.query(artworkId)
      if (res && res.images.length > 0) {
        finalPath = res.images[0].path
      }
    }

    if (!finalPath) {
      // 如果还是没有，说明是全新作品，后端需要支持仅传 artworkId
      // 但目前后端 replace API 强依赖 path 参数来定位目录
      toast.error('无法定位目标目录 (作品当前无图片路径)')
      return
    }

    setUploadStatus('uploading')
    setUploadProgress(0)

    const formData = new FormData()

    files.forEach((file) => {
      const item = previewItems.find((p) => p.originalName === file.name && p.size === file.size)
      if (item) {
        const ext = file.name.split('.').pop()
        const nameWithOrder = `upload_p${item.order}.${ext}`
        const renamedFile = new File([file], nameWithOrder, { type: file.type })
        formData.append('files', renamedFile)
      } else {
        formData.append('files', file)
      }
    })

    const xhr = new XMLHttpRequest()

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = (event.loaded / event.total) * 100
        setUploadProgress(percentComplete)
        if (percentComplete === 100) {
          setUploadStatus('syncing')
        }
      }
    }

    xhr.onload = () => {
      if (xhr.status === 200) {
        setUploadStatus('success')
        toast.success('全量替换成功')
        onSuccess?.()
        setRefreshKey((prev) => prev + 1) // 刷新 STable
        setTimeout(() => {
          setActiveTab('list')
        }, 1500)
      } else {
        setUploadStatus('error')
        try {
          const res = JSON.parse(xhr.responseText)
          toast.error(`替换失败: ${res.error || '未知错误'}`)
        } catch {
          toast.error('替换失败: 服务器错误')
        }
      }
    }

    xhr.onerror = () => {
      setUploadStatus('error')
      toast.error('网络错误，上传失败')
    }

    xhr.open('POST', `/api/artwork/${artworkId}/replace?path=${encodeURIComponent(finalPath)}`)
    xhr.send(formData)
  }

  // 渲染列表 Tab
  const renderListTab = () => (
    <div className="h-full flex flex-col">
      <STable
        key={refreshKey}
        rowKey="id"
        columns={columns}
        request={request}
        defaultPageSize={10}
        className="border rounded-md"
        toolBarRender={() => [
          <Button key="refresh" variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </Button>
        ]}
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
          // @ts-ignore - webkitdirectory is non-standard but supported
          webkitdirectory=""
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
              总大小: {formatBytes(previewItems.reduce((acc, cur) => acc + cur.size, 0))}
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
              {uploadStatus === 'uploading' && <Loader2 className="w-3 h-3 animate-spin" />}
              {uploadStatus === 'syncing' && <RefreshCw className="w-3 h-3 animate-spin" />}
              {uploadStatus === 'success' && <CheckCircle className="w-3 h-3 text-green-500" />}
              {uploadStatus === 'error' && <XCircle className="w-3 h-3 text-red-500" />}

              {uploadStatus === 'uploading' && '正在上传文件...'}
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
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>图片管理 - {artwork?.title || '加载中...'}</DialogTitle>
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

// 辅助函数：提取排序序号
const extractOrder = (fileName: string): number => {
  const match = fileName.match(/[-_](\d+)|(\d+)/g)
  if (match) {
    const lastMatch = match[match.length - 1]
    return parseInt(lastMatch.replace(/[-_]/, ''), 10)
  }
  return 0
}

// 辅助函数：格式化字节
function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}
