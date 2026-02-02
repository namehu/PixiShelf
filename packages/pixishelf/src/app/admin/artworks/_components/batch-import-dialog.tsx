'use client'

import { useState, useEffect } from 'react'
import { ProDialog } from '@/components/shared/pro-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Trash2, Folder, File, AlertCircle, CheckCircle, Loader2, FolderInput } from 'lucide-react'
import { toast } from 'sonner'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { useTRPCClient } from '@/lib/trpc'
import { useBatchImportDrag, BatchImportItem } from '../_hooks/use-batch-import-drag'
import { batchCreateArtworksAction, batchRegisterImagesAction } from '@/actions/batch-import-action'
import { cn } from '@/lib/utils'
import { BatchImportArtworkSchema } from '@/schemas/artwork.dto'

interface BatchImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type ImportStatus = 'idle' | 'creating' | 'uploading' | 'registering' | 'completed' | 'error'

interface ExtendedImportItem extends BatchImportItem, Partial<Omit<BatchImportArtworkSchema, 'id' | 'title'>> {
  status: 'pending' | 'uploading' | 'done' | 'error'
  progress: number
  artistId?: number
  artworkId?: number
  externalId?: string
  uploadedFiles?: { fileName: string; size: number }[]
}

export function BatchImportDialog({ open, onOpenChange, onSuccess }: BatchImportDialogProps) {
  const trpcClient = useTRPCClient()
  const [items, setItems] = useState<ExtendedImportItem[]>([])
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [globalProgress, setGlobalProgress] = useState(0)

  // Global Config
  const [artist, setArtist] = useState<Option | null>(null)
  const [tags, setTags] = useState<Option[]>([])

  const disabled = (status !== 'idle' && status !== 'error') || !items.length || !artist
  // Drag Hook
  const { isDragging, dragHandlers, processFiles } = useBatchImportDrag({
    onDrop: (newItems) => {
      setItems((prev) => [
        ...prev,
        ...newItems.map((item) => ({
          ...item,
          status: 'pending' as const,
          progress: 0
        }))
      ])
    },
    disabled: status !== 'idle'
  })

  useEffect(() => {
    if (!open) {
      setStatus('idle')
      setGlobalProgress(0)
      setItems([])
    }
  }, [open])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files)
      const newItems = processFiles(files)

      setItems((prev) => [
        ...prev,
        ...newItems.map((item) => ({
          ...item,
          status: 'pending' as const,
          progress: 0
        }))
      ])
    }
  }

  const handleTitleChange = (id: string, newTitle: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, title: newTitle } : i)))
  }

  const handleSearchArtist = async (value: string): Promise<Option[]> => {
    const res = await trpcClient.artist.queryPage.query({
      cursor: 1,
      pageSize: 20,
      search: value
    })
    return res.data.map((artist) => ({
      value: artist.id.toString(),
      userId: artist.userId,
      label: artist.name
    }))
  }

  const handleSearchTag = async (value: string): Promise<Option[]> => {
    const res = await trpcClient.tag.list.query({
      cursor: 1,
      pageSize: 20,
      mode: 'popular',
      query: value
    })
    return res.items.map((tag) => ({
      value: tag.id.toString(),
      label: tag.name
    }))
  }

  // --- Core Logic ---
  const uploadSingleFile = async (
    data: { file: File; fileName: string; targetRelDir: string; uploadTargetDir: string },
    onProgress: (percent: number) => void
  ) => {
    const { file, fileName, targetRelDir, uploadTargetDir } = data
    const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)

      const headers: Record<string, string> = {
        'x-file-name': encodeURIComponent(fileName),
        'x-target-dir': encodeURIComponent(uploadTargetDir),
        'x-target-rel-dir': encodeURIComponent(targetRelDir || ''),
        'x-chunk-index': chunkIndex.toString(),
        'x-total-chunks': totalChunks.toString()
      }

      const res = await fetch('/api/artwork/upload-chunk', {
        method: 'POST',
        headers,
        body: chunk
      })

      if (!res.ok) {
        throw new Error(`Chunk ${chunkIndex} upload failed`)
      }

      onProgress(Math.round(((chunkIndex + 1) / totalChunks) * 100))
    }
  }

  // Refactored Start Import
  const handleStartImport = async () => {
    if (disabled) return
    setStatus('creating')
    setGlobalProgress(0)

    try {
      // 1. Create Artworks
      const createRes = await batchCreateArtworksAction({
        artworks: items.map((item) => ({
          tempId: item.id,
          title: item.title,
          artistId: parseInt(artist.value),
          artistUserId: artist.userId as any,
          tagIds: tags.map((t) => parseInt(t.value))
        }))
      })

      if (!createRes?.data) {
        throw new Error('创建作品失败')
      }

      const createdMap = new Map(createRes.data.map((r) => [r.tempId, r]))
      const itemsToProcess = items.map(
        (item) =>
          ({
            ...item,
            ...(createdMap.get(item.id) || {}),
            status: 'pending',
            progress: 0
          }) as ExtendedImportItem
      )

      setItems(itemsToProcess)
      setStatus('uploading')

      let totalFiles = itemsToProcess.reduce((acc, item) => acc + item.files.length, 0)
      let uploadedTotal = 0

      const registrationItems = []

      for (const item of itemsToProcess) {
        const { id, externalId, targetRelDir, uploadTargetDir } = item

        if (!id || !externalId || !targetRelDir || !uploadTargetDir) continue

        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'uploading' } : i)))

        const itemFiles = item.files.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        )
        const uploadedFilesForThisItem: { fileName: string; size: number; path: string }[] = []

        for (let j = 0; j < itemFiles.length; j++) {
          const file = itemFiles[j]!
          const ext = file.name.split('.').pop() || 'jpg'
          const newName = `${item.externalId}_p${j}.${ext}`

          try {
            await uploadSingleFile({ file, fileName: newName, targetRelDir, uploadTargetDir }, (pct) => {
              setItems((prev) =>
                prev.map((i) =>
                  i.id === item.id
                    ? {
                        ...i,
                        progress: Math.round(((j + pct / 100) / itemFiles.length) * 100)
                      }
                    : i
                )
              )
            })

            uploadedFilesForThisItem.push({
              fileName: newName,
              path: `${targetRelDir}/${newName}`,
              size: file.size
            })
            uploadedTotal++
            setGlobalProgress((uploadedTotal / totalFiles) * 100)
          } catch (e) {
            console.error(`Failed to upload ${file.name}`, e)
            toast.error(`文件上传失败: ${file.name}`)
          }
        }

        registrationItems.push({
          artworkId: item.id as any,
          images: uploadedFilesForThisItem
        })

        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'done', progress: 100 } : i)))
      }

      // 3. Register
      setStatus('registering')
      await batchRegisterImagesAction({ items: registrationItems })

      setStatus('completed')
      toast.success('批量导入完成')
      onSuccess()
      onOpenChange(false)
    } catch (e: any) {
      console.error(e)
      toast.error('导入过程中发生错误')
      setStatus('error')
    }
  }

  return (
    <ProDialog
      title="批量导入作品"
      open={open}
      onOpenChange={onOpenChange}
      width={1000}
      footer={
        <div className="space-y-2">
          {status !== 'idle' && (
            <div className="flex items-center gap-2 text-sm">
              <Progress value={globalProgress} className="flex-1" />
              <span className="w-12 text-right">{Math.round(globalProgress)}%</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={status !== 'idle' && status !== 'completed' && status !== 'error'}
            >
              取消
            </Button>
            <Button onClick={handleStartImport} disabled={disabled}>
              {status === 'idle' ? '开始导入' : status === 'completed' ? '已完成' : '导入中...'}
            </Button>
          </div>
        </div>
      }
    >
      <div
        className={cn(
          'flex h-[600px] gap-4 relative',
          isDragging &&
            "after:absolute after:inset-0 after:bg-blue-500/10 after:border-2 after:border-blue-500 after:border-dashed after:z-50 after:content-['释放以添加文件'] after:flex after:items-center after:justify-center after:text-blue-600 after:font-bold after:text-xl"
        )}
        {...dragHandlers}
      >
        {/* Left: Configuration */}
        <div className="w-1/3 flex flex-col gap-4 border-r pr-4">
          <div className="space-y-2">
            <Label>默认艺术家 (应用到所有)</Label>
            <MultipleSelector
              placeholder="搜索艺术家..."
              defaultOptions={[]}
              value={artist ? [artist] : []}
              onSearch={handleSearchArtist}
              triggerSearchOnFocus
              onChange={(opts) => setArtist(opts[0] || null)}
              maxSelected={1}
            />
          </div>
          <div className="space-y-2">
            <Label>默认标签 (应用到所有)</Label>
            <MultipleSelector
              triggerSearchOnFocus
              placeholder="搜索标签..."
              defaultOptions={[]}
              value={tags}
              onSearch={handleSearchTag}
              onChange={setTags}
            />
          </div>

          <div className="mt-auto bg-neutral-50 p-4 rounded-lg border text-sm text-neutral-500 space-y-2">
            <p className="font-medium text-neutral-900">使用说明</p>
            <ul className="list-disc list-inside space-y-1">
              <li>拖拽文件：创建单文件作品</li>
              <li>拖拽文件夹：创建包含目录下所有文件的作品</li>
              <li>自动识别文件名/文件夹名为作品标题</li>
              <li>导入后会自动重命名并关联</li>
            </ul>
          </div>
        </div>

        {/* Right: Preview List */}
        <div className="w-2/3 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">待导入列表 ({items.length})</h3>
            {items.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setItems([])} disabled={status !== 'idle'}>
                清空列表
              </Button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-neutral-400 gap-2 relative p-4 hover:bg-neutral-50 transition-colors cursor-pointer border-2 border-dashed border-transparent hover:border-neutral-200 m-2 rounded-lg">
              <input
                type="file"
                multiple
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleFileSelect}
                disabled={status !== 'idle'}
              />
              <FolderInput className="w-10 h-10" />
              <div className="text-center space-y-1">
                <p className="font-medium">点击选择 / 拖拽文件夹或文件</p>
                <p className="text-xs text-neutral-400">支持批量选择，自动识别作品标题</p>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1 border rounded-md">
              <div className="space-y-2 p-4">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-3 border rounded bg-white group">
                    <div className="w-10 h-10 bg-neutral-100 flex items-center justify-center rounded shrink-0 text-neutral-500">
                      {item.type === 'collection' ? <Folder size={20} /> : <File size={20} />}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Input
                          value={item.title}
                          onChange={(e) => handleTitleChange(item.id, e.target.value)}
                          className="h-7 text-sm px-2 w-full"
                          disabled={status !== 'idle'}
                        />
                      </div>
                      {item.status !== 'pending' && <Progress value={item.progress} className="h-1 mt-1" />}
                    </div>
                    <div className="shrink-0">
                      {item.status === 'pending' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-neutral-400 hover:text-red-500 transition-opacity"
                          onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                        >
                          <Trash2 size={16} />
                        </Button>
                      ) : item.status === 'done' ? (
                        <CheckCircle className="text-green-500 w-5 h-5" />
                      ) : item.status === 'error' ? (
                        <AlertCircle className="text-red-500 w-5 h-5" />
                      ) : (
                        <Loader2 className="animate-spin text-blue-500 w-5 h-5" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </ProDialog>
  )
}
