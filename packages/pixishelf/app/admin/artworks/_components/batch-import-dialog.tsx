'use client'

import { useState, useEffect, useRef } from 'react'
import { ProDialog } from '@/components/shared/pro-dialog'
import { ProDatePicker } from '@/components/shared/pro-date-picker'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Trash2, Folder, File as FileIcon, AlertCircle, CheckCircle, Loader2, FolderInput, InfoIcon } from 'lucide-react'
import { toast } from 'sonner'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { useTRPCClient } from '@/lib/trpc'
import { useBatchImportDrag, BatchImportItem } from '../_hooks/use-batch-import-drag'
import { useChunkUpload } from '../_hooks/use-chunk-upload'
import { batchCreateArtworksAction, batchRegisterImagesAction } from '@/actions/batch-import-action'
import { cn } from '@/lib/utils'
import { BatchImportArtworkSchema } from '@/schemas/artwork.dto'
import { useRecentTags } from '@/store/admin/use-recent-tags'
import { RecentTagsList } from './recent-tags-list'
import { parseFileDate, parseDateFromFilename, DateSource } from '@/lib/date-parser'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

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
  // 新增字段（仅批量导入流程内使用）
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

  // 全局默认配置（阶段一）
  const [artist, setArtist] = useState<Option | null>(null)
  const [defaultTags, setDefaultTags] = useState<Option[]>([])
  const [defaultSourceDate, setDefaultSourceDate] = useState<Date>(new Date())

  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    overscan: 5
  })

  const { uploadSingleFile } = useChunkUpload()

  const disabled = (status !== 'idle' && status !== 'error') || !items.length || !artist

  // 新增条目时先做日期解析（为每条记录预置元数据）
  const processNewItems = async (newItems: BatchImportItem[]) => {
    const processed = await Promise.all(
      newItems.map(async (item) => {
        // 优先尝试从目录/文件名解析日期；
        // 回退到文件内容/主文件名解析，兼容单文件与文件夹两类导入源。

        let dateResult: { date: Date; source: DateSource } = { date: defaultSourceDate, source: 'default' }

        // 1. 先从 item.title（文件/文件夹名）解析日期
        const mainFile = item.files[0]

        if (mainFile) {
          // 文件夹场景下优先以文件夹名作为日期依据，单文件则继续用文件解析。
          const titleDate = parseDateFromFilename(item.title)

          if (titleDate) {
            dateResult = { date: titleDate, source: 'filename' }
          } else {
            // 兜底到主文件的文件名/元数据解析
            dateResult = await parseFileDate(mainFile, defaultSourceDate)
          }
        }

        return {
          ...item,
          status: 'pending' as const,
          progress: 0,
          parsedDate: dateResult.date,
          dateSource: dateResult.source,
          tags: [...defaultTags] // 继承默认标签
        }
      })
    )
    return processed
  }

  // 拖拽 Hook
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
      // 关闭弹窗时清空列表与状态；默认日期重置为今天，避免影响下一次独立导入会话。
      // 如需保留标签可恢复相关语句，但当前偏向“显式开始”更安全。
      // 重新打开窗口时保持“从空白开始”，减少误用上一次的默认配置
      setDefaultSourceDate(new Date())
      // setDefaultTags([]) // 如需保留标签，可恢复该行
    } else {
      // 默认日期固定到当天 00:00:00（本次会话的归档兜底值）
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
      // 重置 input，允许重复选择同名文件再次触发 onChange
      e.target.value = ''
    }
  }

  const handleDateChange = (id: string, date: Date | undefined) => {
    if (!date) return
    // 将日期源标记为可读来源，避免“解析中/未知日期”错误状态
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, parsedDate: date, dateSource: 'filename' as const } : i)))
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

  // --- 核心处理流程 ---

  const handleStartImport = async () => {
    if (disabled) return

    // 先做基础校验
    const invalidItems = items.filter((i) => !i.parsedDate) // 正常逻辑下不应出现，但保底兜底
    if (invalidItems.length > 0) {
      toast.error('存在无效的日期，请检查')
      return
    }

    setStatus('creating')
    setGlobalProgress(0)

    try {
      // 1. 创建作品：逐条提交解析后的日期与标签（每条独立）
      const createRes = await batchCreateArtworksAction({
        artworks: items.map((item) => ({
          tempId: item.id,
          title: item.title,
          artistId: parseInt(artist.value),
          artistUserId: artist.userId as any,
          tagIds: item.tags.map((t) => parseInt(t.value)), // 使用条目自身标签（支持异构标签集）
          sourceDate: format(item.parsedDate, 'yyyy-MM-dd') // 使用条目自身归档日期
        }))
      })

      if (!createRes?.data) {
        throw new Error('创建作品失败')
      }

      const createdMap = new Map(createRes.data.artworks.map((r) => [r.tempId, r]))
      const scanRunId = createRes.data.scanRunId
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

      // 3. 注册图片索引（写入扫描运行记录）
      if (registrationItems.length > 0) {
        setStatus('registering')
        const registerRes = await batchRegisterImagesAction({ scanRunId, items: registrationItems })
        if (registerRes?.serverError || !registerRes?.data?.success) {
          throw new Error(registerRes?.serverError ?? '注册图片失败')
        }
      }

      const hasErrors = itemsToProcess.some((i) => i.status === 'error')

      if (hasErrors) {
        setStatus('error') // 存在错误条目时标记失败态，避免误认为全量成功
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
      width={1200}
      className="max-h-[calc(100dvh-1rem)] overflow-hidden sm:max-h-[calc(100dvh-2rem)]"
      footer={
        <div className="flex w-full flex-col gap-2">
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
          'relative flex h-[min(68dvh,600px)] min-h-0 flex-col gap-4 overflow-y-auto lg:flex-row lg:overflow-hidden',
          isDragging &&
            "after:absolute after:inset-0 after:z-50 after:flex after:items-center after:justify-center after:border-2 after:border-dashed after:border-primary after:bg-primary/10 after:text-xl after:font-bold after:text-primary after:content-['释放以添加文件']"
        )}
        {...dragHandlers}
      >
        <Alert variant="info" className="lg:hidden">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>大批量操作建议使用桌面端</AlertTitle>
          <AlertDescription>手机可检查默认值、添加文件并查看进度；数量较多时请在桌面端完成逐项调整。</AlertDescription>
        </Alert>
        {/* 左侧：第一阶段配置 */}
        <div className="flex w-full shrink-0 flex-col gap-4 border-b border-border pb-4 lg:w-[300px] lg:border-r lg:border-b-0 lg:pr-4 lg:pb-0">
          <div className="font-semibold text-lg flex items-center gap-2">
            <span>🛠️ 默认设置</span>
            <span className="text-xs font-normal text-muted-foreground">(仅对新增生效)</span>
          </div>

          <div className="flex flex-col gap-2">
            <Label>
              默认艺术家 <span className="text-destructive">*</span>
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
          <div className="flex flex-col gap-2">
            <Label>默认发布日期</Label>
            <ProDatePicker
              mode="single"
              value={defaultSourceDate}
              onChange={(date) => date && setDefaultSourceDate(date)}
              placeholder="选择默认日期"
              clearable={false}
            />
          </div>
          <div className="flex flex-col gap-2">
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

          <div className="mt-auto flex flex-col gap-2 rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">使用说明</p>
            <ul className="flex list-inside list-disc flex-col gap-1 text-xs">
              <li>阶段1：设置默认值</li>
              <li>阶段2：拖入文件，自动解析时间</li>
              <li>红色边框表示使用了默认时间(解析失败)</li>
              <li>可逐条修改时间和标签</li>
            </ul>
          </div>
        </div>

        {/* 右侧：第二阶段预览列表 */}
        <div className="flex min-h-[24rem] min-w-0 flex-1 flex-col gap-4 lg:min-h-0">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">待导入列表 ({items.length})</h3>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <label aria-disabled={status !== 'idle'}>
                  <FolderInput data-icon="inline-start" aria-hidden="true" />
                  <span>添加文件</span>
                <input
                  type="file"
                  name="batch-import-files"
                  multiple
                  className="sr-only"
                  onChange={handleFileSelect}
                  disabled={status !== 'idle'}
                />
                </label>
              </Button>
              {items.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setItems([])} disabled={status !== 'idle'}>
                  清空列表
                </Button>
              )}
            </div>
          </div>

          {items.length === 0 ? (
            <div className="m-2 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/35 text-muted-foreground">
              <FolderInput className="size-12 opacity-50" aria-hidden="true" />
              <div className="flex flex-col gap-1 text-center">
                <p className="font-medium">暂无文件</p>
                <p className="text-xs text-muted-foreground">拖入文件或点击上方按钮添加</p>
              </div>
            </div>
          ) : (
            <ScrollArea viewportRef={parentRef} className="min-h-0 flex-1 rounded-md border border-border bg-background">
              <div className="p-2 w-full">
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative'
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                    const item = items[virtualItem.index]!
                    return (
                      <div
                        key={item.id}
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualItem.index}
                        className="absolute top-0 left-0 w-full pb-1"
                        style={{
                          transform: `translateY(${virtualItem.start}px)`
                        }}
                      >
                        <div
                          className={cn(
                            'flex flex-col gap-2 rounded border border-border bg-background p-3 transition-colors hover:bg-muted/45',
                            item.dateSource === 'default' && 'border-l-4 border-l-destructive'
                          )}
                        >
                          {/* 顶行：图标、标题和状态 */}
                          <div className="flex items-center gap-3">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
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
                                  className="size-7 text-muted-foreground hover:text-destructive"
                                  onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                                  aria-label={`移除 ${item.title}`}
                                >
                                  <Trash2 aria-hidden="true" />
                                </Button>
                              ) : item.status === 'done' ? (
                                <span className="inline-flex items-center text-success">
                                  <CheckCircle className="size-5" aria-hidden="true" />
                                  <span className="sr-only">已完成</span>
                                </span>
                              ) : item.status === 'error' ? (
                                <div className="flex items-center gap-1 text-xs text-destructive">
                                  <AlertCircle className="size-4" aria-hidden="true" />
                                  <span>{item.errorMsg || '导入失败'}</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-primary">{item.progress}%</span>
                                  <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 底行：操作控件 */}
                          {item.status === 'pending' && (
                            <div className="flex gap-2 pl-11">
                              {/* 日期选择器 */}
                              <div className="w-[160px] shrink-0">
                                <ProDatePicker
                                  mode="single"
                                  value={item.parsedDate}
                                  onChange={(date) => handleDateChange(item.id, date)}
                                  clearable={false}
                                  className={cn(
                                    'h-8 text-xs',
                                    item.dateSource === 'default' && 'border-destructive/30 bg-destructive/5'
                                  )}
                                />
                              </div>

                              {/* 标签 */}
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
                      </div>
                    )
                  })}
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </ProDialog>
  )
}
