'use client'

import { useState, useEffect } from 'react'
import { ProDialog } from '@/components/shared/pro-dialog'
import { ProDatePicker } from '@/components/shared/pro-date-picker'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Trash2, Folder, File as FileIcon, AlertCircle, CheckCircle, Loader2, FolderInput } from 'lucide-react'
import { toast } from 'sonner'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { useTRPCClient } from '@/lib/trpc'
import { useBatchImportDrag, BatchImportItem } from '../_hooks/use-batch-import-drag'
import { useChunkUpload } from '../_hooks/use-chunk-upload'
import { batchCreateArtworksAction, batchRegisterImagesAction } from '@/actions/batch-import-action'
import { cn } from '@/lib/utils'
import { BatchImportArtworkSchema } from '@/schemas/artwork.dto'
import { useRecentTags } from '@/store/admin/useRecentTags'
import { RecentTagsList } from './recent-tags-list'
import { parseFileDate, parseDateFromFilename, DateSource } from '@/lib/date-parser'

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
  // New fields
  parsedDate: Date
  dateSource: DateSource
  tags: Option[]
  errorMsg?: string
}

export function BatchImportDialog({ open, onOpenChange, onSuccess }: BatchImportDialogProps) {
  const trpcClient = useTRPCClient()
  const { addTag } = useRecentTags()
  const [items, setItems] = useState<ExtendedImportItem[]>([])
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [globalProgress, setGlobalProgress] = useState(0)

  // Global Config (Stage 1)
  const [artist, setArtist] = useState<Option | null>(null)
  const [defaultTags, setDefaultTags] = useState<Option[]>([])
  const [defaultSourceDate, setDefaultSourceDate] = useState<Date>(new Date())

  const { uploadSingleFile } = useChunkUpload()

  const disabled = (status !== 'idle' && status !== 'error') || !items.length || !artist

  // Helper to process new items with date parsing
  const processNewItems = async (newItems: BatchImportItem[]) => {
    const processed = await Promise.all(
      newItems.map(async (item) => {
        // Determine file to parse date from
        // If collection, use the first file or just rely on title (folder name)
        // But parseFileDate takes a File object.
        // If we want to parse from title, we can pass a dummy file or use parseDateFromFilename directly?
        // Better: use parseFileDate with the first file, but override filename check with item.title if needed?
        // Actually, item.title IS the filename/foldername.

        let dateResult: { date: Date; source: DateSource } = { date: defaultSourceDate, source: 'default' }

        // 1. Try parsing from item title (filename/foldername) first
        // We can reuse the logic in parseFileDate but we need to expose parseDateFromFilename or construct a dummy file
        // Let's use the first file for metadata fallback
        const mainFile = item.files[0]

        if (mainFile) {
          // We construct a 'virtual' file with item.title to test the title parser
          // But item.title might not have extension if it's a folder, or might be edited?
          // Actually item.title is initially derived from file/folder name.
          // Let's just pass the main file. parseFileDate checks filename then metadata.
          // However, if it's a collection (folder), item.title is the folder name. mainFile.name is a file inside.
          // We usually want the folder name date if present.

          // If it's a collection, we might want to test item.title first.
          // Let's manually check title first
          const titleDate = parseDateFromFilename(item.title)

          if (titleDate) {
            dateResult = { date: titleDate, source: 'filename' }
          } else {
            // Fallback to file parsing (metadata or filename of the file itself)
            dateResult = await parseFileDate(mainFile, defaultSourceDate)
          }
        }

        return {
          ...item,
          status: 'pending' as const,
          progress: 0,
          parsedDate: dateResult.date,
          dateSource: dateResult.source,
          tags: [...defaultTags] // Inherit default tags
        }
      })
    )
    return processed
  }

  // Drag Hook
  const { isDragging, dragHandlers, processFiles } = useBatchImportDrag({
    onDrop: async (newItems) => {
      const processed = await processNewItems(newItems)
      setItems((prev) => [...prev, ...processed])
    },
    disabled: status !== 'idle'
  })

  useEffect(() => {
    if (!open) {
      setStatus('idle')
      setGlobalProgress(0)
      setItems([])
      // Reset defaults is optional, maybe keep them?
      // Requirement: "Component first render... default to today...".
      // "Any subsequent added files inherit...".
      // If user closes and reopens, maybe reset? Usually better UX to keep if accidental close, but safe to reset.
      setDefaultSourceDate(new Date())
      // setDefaultTags([]) // Keep tags maybe?
    } else {
      // Ensure date is set to start of day
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      setDefaultSourceDate(today)
    }
  }, [open])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files)
      const newItems = processFiles(files)
      const processed = await processNewItems(newItems)

      setItems((prev) => [...prev, ...processed])
      // Reset input
      e.target.value = ''
    }
  }

  const handleTitleChange = (id: string, newTitle: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, title: newTitle } : i)))
  }

  const handleDateChange = (id: string, date: Date | undefined) => {
    if (!date) return
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, parsedDate: date, dateSource: 'filename' as const } : i))) // Set source to something valid to remove error state if any
  }

  const handleTagsChange = (id: string, newTags: Option[]) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, tags: newTags } : i)))
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

  const handleStartImport = async () => {
    if (disabled) return

    // Validate
    const invalidItems = items.filter((i) => !i.parsedDate) // Should not happen given logic, but check
    if (invalidItems.length > 0) {
      toast.error('存在无效的日期，请检查')
      return
    }

    setStatus('creating')
    setGlobalProgress(0)

    try {
      // 1. Create Artworks
      // Payload must include parsedDate and tags per item
      const createRes = await batchCreateArtworksAction({
        artworks: items.map((item) => ({
          tempId: item.id,
          title: item.title,
          artistId: parseInt(artist.value),
          artistUserId: artist.userId as any,
          tagIds: item.tags.map((t) => parseInt(t.value)), // Use item specific tags
          sourceDate: format(item.parsedDate, 'yyyy-MM-dd') // Use item specific date
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

        if (!id || !externalId || !targetRelDir || !uploadTargetDir) {
          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'error', errorMsg: '创建失败' } : i)))
          continue
        }

        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'uploading' } : i)))

        const itemFiles = item.files.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        )
        const uploadedFilesForThisItem: { fileName: string; size: number; path: string }[] = []

        let itemError = false

        for (let j = 0; j < itemFiles.length; j++) {
          const file = itemFiles[j]!
          const ext = file.name.split('.').pop() || 'jpg'
          const newName = `${item.externalId}_p${j}.${ext}`

          try {
            await uploadSingleFile(file, newName, uploadTargetDir, targetRelDir, (pct) => {
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
            itemError = true
          }
        }

        if (itemError) {
          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'error', errorMsg: '上传失败' } : i)))
        } else {
          registrationItems.push({
            artworkId: item.id as any,
            images: uploadedFilesForThisItem
          })

          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'done', progress: 100 } : i)))
        }
      }

      // 3. Register
      if (registrationItems.length > 0) {
        setStatus('registering')
        await batchRegisterImagesAction({ items: registrationItems })
      }

      const hasErrors = itemsToProcess.some((i) => i.status === 'error')

      if (hasErrors) {
        setStatus('error') // Or 'completed' but with errors?
        toast.warning('部分导入失败，请检查列表')
      } else {
        setStatus('completed')
        toast.success('批量导入完成')
        onSuccess()
        onOpenChange(false)
      }
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
      width={1200} // Widen for table-like list
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
        {/* Left: Configuration (Stage 1) */}
        <div className="w-[300px] flex flex-col gap-4 border-r pr-4 shrink-0">
          <div className="font-semibold text-lg flex items-center gap-2">
            <span>🛠️ 默认设置</span>
            <span className="text-xs font-normal text-muted-foreground">(仅对新增生效)</span>
          </div>

          <div className="space-y-2">
            <Label>
              默认艺术家 <span className="text-red-500">*</span>
            </Label>
            <MultipleSelector
              placeholder="搜索艺术家..."
              value={artist ? [artist] : []}
              onSearch={handleSearchArtist}
              triggerSearchOnFocus
              onChange={(opts) => setArtist(opts[0] || null)}
              maxSelected={1}
            />
          </div>
          <div className="space-y-2 flex flex-col">
            <Label>默认发布日期</Label>
            <ProDatePicker
              mode="single"
              value={defaultSourceDate}
              onChange={(date) => date && setDefaultSourceDate(date)}
              placeholder="选择默认日期"
              clearable={false}
            />
          </div>
          <div className="space-y-2">
            <Label>默认标签</Label>
            <MultipleSelector
              triggerSearchOnFocus
              placeholder="搜索标签..."
              value={defaultTags}
              onSearch={handleSearchTag}
              onChange={(options) => {
                options.forEach((opt) => {
                  if (!defaultTags.some((t) => t.value === opt.value)) {
                    addTag({ value: opt.value, label: opt.label })
                  }
                })
                setDefaultTags(options)
              }}
            />
            <RecentTagsList
              selectedValues={defaultTags.map((t) => t.value)}
              onSelect={(tag) => {
                setDefaultTags([...defaultTags, tag as any])
              }}
            />
          </div>

          <div className="mt-auto bg-neutral-50 p-4 rounded-lg border text-sm text-neutral-500 space-y-2">
            <p className="font-medium text-neutral-900">使用说明</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>阶段1：设置默认值</li>
              <li>阶段2：拖入文件，自动解析时间</li>
              <li>红色边框表示使用了默认时间(解析失败)</li>
              <li>可逐条修改时间和标签</li>
            </ul>
          </div>
        </div>

        {/* Right: Preview List (Stage 2) */}
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">待导入列表 ({items.length})</h3>
            <div className="flex gap-2">
              <div className="relative">
                <Button variant="outline" size="sm">
                  <FolderInput className="w-4 h-4 mr-2" />
                  添加文件
                </Button>
                <input
                  type="file"
                  multiple
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={handleFileSelect}
                  disabled={status !== 'idle'}
                />
              </div>
              {items.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setItems([])} disabled={status !== 'idle'}>
                  清空列表
                </Button>
              )}
            </div>
          </div>

          {items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-neutral-400 gap-2 border-2 border-dashed border-neutral-200 m-2 rounded-lg bg-neutral-50/50">
              <FolderInput className="w-12 h-12 text-neutral-300" />
              <div className="text-center space-y-1">
                <p className="font-medium">暂无文件</p>
                <p className="text-xs text-neutral-400">请从左侧拖入文件或点击上方按钮添加</p>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1 min-h-0 border rounded-md bg-white">
              <div className="space-y-1 p-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      'flex flex-col gap-2 p-3 border rounded bg-white hover:bg-neutral-50 transition-colors',
                      item.dateSource === 'default' && 'border-l-4 border-l-red-400' // Visual hint for fallback
                    )}
                  >
                    {/* Top Row: Icon + Title + Status */}
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-neutral-100 flex items-center justify-center rounded shrink-0 text-neutral-500">
                        {item.type === 'collection' ? <Folder size={16} /> : <FileIcon size={16} />}
                      </div>
                      <div className="flex-1 min-w-0 font-medium text-sm truncate" title={item.title}>
                        {item.title}
                      </div>
                      <div className="shrink-0">
                        {item.status === 'pending' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-neutral-400 hover:text-red-500"
                            onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                          >
                            <Trash2 size={14} />
                          </Button>
                        ) : item.status === 'done' ? (
                          <CheckCircle className="text-green-500 w-5 h-5" />
                        ) : item.status === 'error' ? (
                          <div className="flex items-center gap-1 text-red-500 text-xs">
                            <AlertCircle className="w-4 h-4" />
                            <span>{item.errorMsg || 'Error'}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-blue-500">{item.progress}%</span>
                            <Loader2 className="animate-spin text-blue-500 w-4 h-4" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom Row: Controls */}
                    {item.status === 'pending' && (
                      <div className="flex gap-2 pl-11">
                        {/* Date Picker */}
                        <div className="w-[160px] shrink-0">
                          <ProDatePicker
                            mode="single"
                            value={item.parsedDate}
                            onChange={(date) => handleDateChange(item.id, date)}
                            clearable={false}
                            className={cn('h-8 text-xs', item.dateSource === 'default' && 'border-red-200 bg-red-50')}
                          />
                        </div>

                        {/* Tags */}
                        <div className="flex-1 min-w-0">
                          <MultipleSelector
                            value={item.tags}
                            onChange={(tags) => handleTagsChange(item.id, tags)}
                            onSearch={handleSearchTag}
                            triggerSearchOnFocus
                            placeholder="添加标签..."
                            className="text-xs py-1 min-h-[32px]"
                            badgeClassName="text-[10px] h-5"
                          />
                        </div>
                      </div>
                    )}

                    {item.status !== 'pending' && <Progress value={item.progress} className="h-1 mt-1 mx-1" />}
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
