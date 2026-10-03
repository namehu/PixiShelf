'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { File, Folder, Info, RefreshCw } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { DELETE_KIND_LABELS, type ArtworkDeleteInput, type ArtworkDeletePreview } from '@/schemas/artwork-delete.dto'

type Props = {
  artworkId: number | null
  loadPreview: (id: number) => Promise<ArtworkDeletePreview>
  onDelete: (input: ArtworkDeleteInput) => Promise<void>
  onClose: () => void
}

export function ArtworkDeletePreviewDrawer({ artworkId, loadPreview, onDelete, onClose }: Props) {
  const [preview, setPreview] = useState<ArtworkDeletePreview | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setPreview(null)
    setFailed(false)
    if (artworkId !== null) {
      loadPreview(artworkId).then(
        (value) => {
          if (active) setPreview(value)
        },
        () => {
          if (active) setFailed(true)
        }
      )
    }
    return () => {
      active = false
    }
  }, [artworkId, loadPreview, reload])
  const current = preview?.artwork.id === artworkId ? preview : null
  return (
    <Sheet
      open={artworkId !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <SheetContent
        className="w-full gap-0 sm:max-w-4xl"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <SheetHeader className="shrink-0 border-b py-3 pr-12">
          <SheetTitle>删除作品前预览</SheetTitle>
          <SheetDescription className="sr-only">选择要删除的附属文件，已登记媒体固定删除。</SheetDescription>
        </SheetHeader>
        {current ? (
          <PreviewContent
            key={`${artworkId}-${reload}`}
            preview={current}
            onDelete={onDelete}
            onClose={onClose}
            onReload={() => setReload((value) => value + 1)}
            onBusyChange={setBusy}
          />
        ) : failed ? (
          <div className="flex flex-col gap-4 px-4">
            <Alert variant="destructive">
              <AlertTitle>无法读取删除清单</AlertTitle>
              <AlertDescription>未执行任何删除，请重新加载。</AlertDescription>
            </Alert>
            <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
              重新加载
            </Button>
          </div>
        ) : (
          <p className="px-4 text-sm text-muted-foreground" role="status">
            正在检查文件目录…
          </p>
        )}
      </SheetContent>
    </Sheet>
  )
}

function PreviewContent({
  preview,
  onDelete,
  onClose,
  onReload,
  onBusyChange
}: {
  preview: ArtworkDeletePreview
  onDelete: Props['onDelete']
  onClose: () => void
  onReload: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const [selected, setSelected] = useState(
    () =>
      new Set(
        preview.entries
          .filter((entry) => entry.selection === 'REQUIRED' || entry.selection === 'OPTIONAL')
          .map((entry) => entry.path)
      )
  )
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [pending, setPending] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const inFlight = useRef(false)
  const archive = preview.mode === 'ARCHIVE_TRASH'
  const files = preview.entries.filter((entry) => entry.kind !== 'DIRECTORY' && !entry.missing)
  const deleting = files.filter((entry) => selected.has(entry.path)).length
  const retaining = files.length - deleting
  const canClear =
    preview.directoryMode === 'WORK_DIRECTORY' &&
    preview.canDelete &&
    retaining === 0 &&
    !preview.entries.some((entry) => entry.selection === 'BLOCKED' && !entry.missing)
  const optional = useMemo(() => preview.entries.filter((entry) => entry.selection === 'OPTIONAL'), [preview])
  const filtered = preview.entries.filter(
    (entry) =>
      entry.path.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (filter === 'all' ||
        (filter === 'delete' ? selected.has(entry.path) : entry.kind !== 'DIRECTORY' && !selected.has(entry.path)))
  )
  const toggle = (paths: string[], checked: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous)
      for (const path of paths) {
        if (checked) next.add(path)
        else next.delete(path)
      }
      return next
    })
  const submit = async () => {
    if (inFlight.current || !preview.canDelete || unconfirmed) return
    inFlight.current = true
    setPending(true)
    onBusyChange(true)
    try {
      await onDelete({ artworkId: preview.artwork.id, ...(archive ? {} : { selectedPaths: [...selected] }) })
    } catch {
      setUnconfirmed(true)
    } finally {
      setPending(false)
      onBusyChange(false)
      inFlight.current = false
    }
  }
  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <PrivacySensitiveText className="truncate font-medium">
            {preview.artwork.title} · 作品 #{preview.artwork.id}
          </PrivacySensitiveText>
          <PrivacySensitiveText className="truncate text-xs text-muted-foreground">
            {preview.artwork.directory ?? '仅处理登记文件'}
          </PrivacySensitiveText>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {preview.warnings.length > 0 && !archive && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="范围说明">
                  <Info />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="max-h-60 overflow-y-auto text-sm">
                {preview.warnings.map((warning) => (
                  <p key={warning}>
                    <PrivacySensitiveText>{warning}</PrivacySensitiveText>
                  </p>
                ))}
              </PopoverContent>
            </Popover>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="重新加载"
            disabled={pending || unconfirmed}
            onClick={onReload}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>
      {!preview.canDelete && (
        <Alert variant="destructive" className="mx-4 mb-2 w-auto shrink-0">
          <AlertTitle>清单未完整检查，禁止删除</AlertTitle>
          <AlertDescription>修复目录权限或检查限制后重新加载。</AlertDescription>
        </Alert>
      )}
      {unconfirmed && (
        <Alert variant="destructive" className="mx-4 mb-2 w-auto shrink-0">
          <AlertTitle>删除结果未确认</AlertTitle>
          <AlertDescription>核对作品列表与日志，勿重复提交。</AlertDescription>
        </Alert>
      )}
      {archive ? (
        <p className="flex-1 px-4 py-4 text-sm text-muted-foreground">归档整包移入回收站，保留 7 天。</p>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 px-4 py-2">
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="delete-preview-search" className="sr-only">
                搜索路径
              </FieldLabel>
              <Input
                id="delete-preview-search"
                placeholder="搜索文件…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={pending}
              />
            </Field>
            <Select value={filter} onValueChange={setFilter} disabled={pending}>
              <SelectTrigger aria-label="显示范围" className="w-28 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="delete">将删除</SelectItem>
                  <SelectItem value="retain">将保留</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 pb-1">
            <span className="text-xs tabular-nums text-muted-foreground">{filtered.length} 项</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={pending || !optional.length}
                onClick={() =>
                  toggle(
                    optional.map((entry) => entry.path),
                    true
                  )
                }
              >
                全选附属
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending || !optional.length}
                onClick={() =>
                  toggle(
                    optional.map((entry) => entry.path),
                    false
                  )
                }
              >
                取消附属
              </Button>
            </div>
          </div>
          <DeleteFileList
            entries={filtered}
            optional={optional}
            selected={selected}
            directory={preview.artwork.directory}
            pending={pending}
            searchKey={`${search}\0${filter}`}
            toggle={toggle}
          />
        </>
      )}
      <SheetFooter className="shrink-0 border-t py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!archive && (
            <div role="status" className="flex min-w-0 flex-col gap-0.5 text-sm tabular-nums">
              <span>
                删除 {deleting} · 保留 {retaining}
              </span>
              <span className="text-xs text-muted-foreground">永久删除 · {canClear ? '清空目录' : '保留目录'}</span>
            </div>
          )}
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="outline" disabled={pending} onClick={onClose}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!preview.canDelete || pending || unconfirmed}
              onClick={() => void submit()}
            >
              {pending ? '正在删除…' : archive ? '确认移入回收站' : '确认删除'}
            </Button>
          </div>
        </div>
      </SheetFooter>
    </>
  )
}

function DeleteFileList({
  entries,
  optional,
  selected,
  directory,
  pending,
  searchKey,
  toggle
}: {
  entries: ArtworkDeletePreview['entries']
  optional: ArtworkDeletePreview['entries']
  selected: Set<string>
  directory: string | null
  pending: boolean
  searchKey: string
  toggle: (paths: string[], checked: boolean) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  // Directory toggles always include unmounted and filtered-out descendants.
  const descendants = useMemo(() => {
    const result = new Map<string, string[]>()
    for (const file of optional) {
      let parent = file.path.lastIndexOf('/')
      while (parent > 0) {
        const name = file.path.slice(0, parent)
        const paths = result.get(name) ?? []
        paths.push(file.path)
        result.set(name, paths)
        parent = file.path.lastIndexOf('/', parent - 1)
      }
    }
    return result
  }, [optional])
  const getItemKey = useCallback((index: number) => entries[index]!.path, [entries])
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => 48,
    overscan: 6,
    useFlushSync: false,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range)
      const focusedIndex = entries.findIndex((entry) => entry.path === focusedPath)
      if (focusedIndex >= 0) indices.push(focusedIndex)
      return [...new Set(indices)].sort((a, b) => a - b)
    }
  })
  useEffect(() => {
    virtual.scrollToOffset(0)
  }, [searchKey, virtual])
  return (
    <div
      ref={scrollRef}
      aria-label="删除文件列表"
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {entries.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">没有匹配的文件</p>
      ) : (
        <div role="list" style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((item) => {
            const entry = entries[item.index]!
            const children = entry.selection === 'DIRECTORY' ? (descendants.get(entry.path) ?? []) : []
            const checkedCount = children.filter((path) => selected.has(path)).length
            const checked =
              entry.selection === 'DIRECTORY'
                ? checkedCount === 0
                  ? false
                  : checkedCount === children.length
                    ? true
                    : 'indeterminate'
                : selected.has(entry.path)
            const disabled =
              pending ||
              entry.selection === 'BLOCKED' ||
              entry.selection === 'REQUIRED' ||
              (entry.selection === 'DIRECTORY' && children.length === 0)
            const isDirectory = entry.kind === 'DIRECTORY'
            const Icon = isDirectory ? Folder : File
            const displayPath =
              directory && entry.path.startsWith(`${directory}/`) ? entry.path.slice(directory.length + 1) : entry.path
            const status = entry.missing
              ? '不存在'
              : isDirectory
                ? entry.selection === 'DIRECTORY'
                  ? '空目录清理'
                  : '保留目录'
                : selected.has(entry.path)
                  ? entry.selection === 'REQUIRED'
                    ? '固定删除'
                    : '删除'
                  : '保留'
            return (
              <div
                key={item.key}
                role="listitem"
                aria-posinset={item.index + 1}
                aria-setsize={entries.length}
                data-delete-index={item.index}
                tabIndex={-1}
                onFocusCapture={() => setFocusedPath(entry.path)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedPath(null)
                }}
                onKeyDown={(event) => {
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const index =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? entries.length - 1
                        : Math.max(0, Math.min(entries.length - 1, item.index + (event.key === 'ArrowDown' ? 1 : -1)))
                  setFocusedPath(entries[index]!.path)
                  virtual.scrollToIndex(index, { align: 'auto' })
                  requestAnimationFrame(() =>
                    scrollRef.current
                      ?.querySelector<HTMLElement>(`[data-delete-index="${index}"]`)
                      ?.focus({ preventScroll: true })
                  )
                }}
                style={{ position: 'absolute', width: '100%', height: 48, transform: `translateY(${item.start}px)` }}
                className={cn(
                  'flex items-center gap-3 border-b border-border/50 px-4 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  isDirectory && 'bg-muted/40'
                )}
              >
                <Checkbox
                  aria-label={`选择 ${entry.path}`}
                  data-privacy-sensitive
                  disabled={disabled}
                  checked={checked}
                  onCheckedChange={(value) =>
                    toggle(entry.selection === 'DIRECTORY' ? children : [entry.path], value === true)
                  }
                />
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`文件详情 ${entry.path}`}
                      data-privacy-sensitive
                    >
                      <PrivacySensitiveText className="block truncate">{displayPath}</PrivacySensitiveText>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="max-w-[calc(100vw-2rem)] text-sm">
                    <PrivacySensitiveText className="block break-all">{entry.path}</PrivacySensitiveText>
                    <p className="mt-2 text-xs text-muted-foreground">{DELETE_KIND_LABELS[entry.kind]}</p>
                    <PrivacySensitiveText className="block text-xs text-muted-foreground">
                      {entry.selection === 'OPTIONAL' && !selected.has(entry.path) ? '用户选择保留' : entry.reason}
                    </PrivacySensitiveText>
                  </PopoverContent>
                </Popover>
                <span className="shrink-0 text-xs text-muted-foreground">{status}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
