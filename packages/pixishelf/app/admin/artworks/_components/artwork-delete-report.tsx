'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import Link from 'next/link'
import { Download, File, Folder, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import {
  DELETE_KIND_LABELS,
  DELETE_OUTCOME_LABELS,
  DELETE_STATUS_LABELS,
  formatArtworkDeleteReport,
  type ArtworkDeleteReport
} from '@/schemas/artwork-delete.dto'

export function ArtworkDeleteReportDrawer({
  report,
  open,
  onOpenChange
}: {
  report: ArtworkDeleteReport | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open && Boolean(report)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-4xl">
        {report ? <ReportContent key={report.reportId} report={report} onClose={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function ReportContent({ report, onClose }: { report: ArtworkDeleteReport; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const filtered = useMemo(() => {
    const query = search.toLocaleLowerCase()
    return report.entries.filter(
      (entry) => (status === 'all' || entry.status === status) && entry.path.toLocaleLowerCase().includes(query)
    )
  }, [report.entries, search, status])
  const archive = report.mode === 'ARCHIVE_TRASH'
  const download = () => {
    let url: string | undefined
    try {
      url = URL.createObjectURL(
        new Blob(['\ufeff', formatArtworkDeleteReport(report)], { type: 'text/plain;charset=utf-8' })
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `pixishelf-delete-${report.artwork.id}-${report.startedAt.replace(/[:.]/g, '-')}.txt`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      const downloadUrl = url
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
    } catch {
      if (url) URL.revokeObjectURL(url)
      toast.error('下载失败，请重试。')
    }
  }
  return (
    <>
      <SheetHeader className="shrink-0 border-b py-3 pr-12">
        <SheetTitle>删除总结</SheetTitle>
        <SheetDescription className="sr-only">查看本次删除结果及文件明细。</SheetDescription>
      </SheetHeader>
      <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <PrivacySensitiveText className="truncate font-medium">
            {report.artwork.title} · 作品 #{report.artwork.id}
          </PrivacySensitiveText>
          <PrivacySensitiveText className="truncate text-xs text-muted-foreground">
            {report.artwork.directory ?? '未确定目录'}
          </PrivacySensitiveText>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="报告详情">
              <Info />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto text-sm">
            <p>
              {new Date(report.finishedAt).toLocaleString()} · {report.artwork.createdVia}
            </p>
            <section aria-label="数据库结果" className="flex flex-col gap-1">
              <p>作品记录：{DELETE_STATUS_LABELS[report.database.artwork]}</p>
              <p>
                媒体记录：{DELETE_STATUS_LABELS[report.database.media]}，删除 {report.database.deletedMediaCount} 条
              </p>
              {report.database.relatedRecords.map((text) => (
                <PrivacySensitiveText as="p" key={text}>
                  {text}
                </PrivacySensitiveText>
              ))}
              <p className="text-xs text-muted-foreground">标签、艺术家和系列保留。</p>
            </section>
            <p>
              原本不存在 {report.counts.missing} · 未执行 {report.counts.notAttempted}
            </p>
            {report.warnings.map((warning, index) => (
              <PrivacySensitiveText as="p" key={index}>
                {warning}
              </PrivacySensitiveText>
            ))}
            {report.archive && (
              <p>
                归档状态：{report.archive.lifecycleState}
                {report.archive.reused ? '（复用已有请求）' : ''}
              </p>
            )}
            <p className="break-all text-xs text-muted-foreground">报告编号：{report.reportId}</p>
            <p className="text-xs text-muted-foreground">刷新或离开后清除。下载包含全部明细和真实路径。</p>
          </PopoverContent>
        </Popover>
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2 text-xs tabular-nums"
      >
        <Badge
          variant={
            report.outcome === 'FAILED'
              ? 'destructive'
              : report.outcome === 'PARTIAL'
                ? 'warning'
                : report.outcome === 'QUEUED'
                  ? 'info'
                  : 'success'
          }
        >
          {DELETE_OUTCOME_LABELS[report.outcome]}
        </Badge>
        {!archive && (
          <>
            <span>
              已删文件 {report.counts.media + report.counts.sidecars} · 目录 {report.counts.directories}
            </span>
            <span>保留 {report.counts.retained}</span>
            {report.counts.failed > 0 && <span className="text-destructive">失败 {report.counts.failed}</span>}
            <span className="text-muted-foreground">
              作品记录{report.database.artwork === 'DELETED' ? '已删除' : '未删除'}
            </span>
          </>
        )}
      </div>
      {!archive && !report.inspectionComplete && (
        <p role="alert" className="shrink-0 px-4 pb-2 text-xs text-destructive">
          目录未完整检查，未列出的文件状态未知。
        </p>
      )}
      {archive ? (
        <div className="flex flex-1 flex-col items-start gap-2 px-4 py-3 text-sm text-muted-foreground">
          <p>文件回收由后台任务处理。</p>
          {report.archive?.jobId && (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/admin/tasks?jobId=${encodeURIComponent(report.archive.jobId)}`}
                target="_blank"
                rel="noreferrer"
              >
                查看回收任务
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 px-4 py-2">
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="delete-report-search" className="sr-only">
                搜索路径
              </FieldLabel>
              <Input
                id="delete-report-search"
                placeholder="搜索文件…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="执行结果" className="w-32 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部结果</SelectItem>
                  {Object.entries(DELETE_STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <ReportFileList entries={filtered} directory={report.artwork.directory} searchKey={`${status}:${search}`} />
        </>
      )}
      <SheetFooter className="shrink-0 border-t py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {archive ? '下载含完整路径' : `${filtered.length} 项 · 下载含完整路径`}
          </span>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={download}>
              <Download data-icon="inline-start" aria-hidden="true" />
              下载总结
            </Button>
            <Button onClick={onClose}>关闭</Button>
          </div>
        </div>
      </SheetFooter>
    </>
  )
}

function ReportFileList({
  entries,
  directory,
  searchKey
}: {
  entries: ArtworkDeleteReport['entries']
  directory: string | null
  searchKey: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const getItemKey = useCallback((index: number) => `${entries[index]!.kind}:${entries[index]!.path}`, [entries])
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => 52,
    overscan: 6,
    useFlushSync: false,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range)
      if (focusedIndex !== null && focusedIndex < entries.length) indices.push(focusedIndex)
      return [...new Set(indices)].sort((a, b) => a - b)
    }
  })
  useEffect(() => {
    virtual.scrollToOffset(0)
    setFocusedIndex(null)
  }, [searchKey, virtual])
  return (
    <div
      ref={scrollRef}
      aria-label="文件与目录明细"
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {entries.length ? (
        <div role="list" style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((item) => {
            const entry = entries[item.index]!
            const Icon = entry.kind === 'DIRECTORY' ? Folder : File
            const path =
              directory && entry.path.startsWith(`${directory}/`) ? entry.path.slice(directory.length + 1) : entry.path
            return (
              <div
                key={item.key}
                role="listitem"
                aria-posinset={item.index + 1}
                aria-setsize={entries.length}
                onFocusCapture={() => setFocusedIndex(item.index)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedIndex(null)
                }}
                style={{ position: 'absolute', width: '100%', height: 52, transform: `translateY(${item.start}px)` }}
                className="flex items-center gap-3 border-b border-border/50 px-4 text-sm hover:bg-accent/50"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`文件详情 ${entry.path}`}
                      data-privacy-sensitive
                      className="flex min-w-0 flex-1 flex-col rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <PrivacySensitiveText className="block w-full truncate">{path}</PrivacySensitiveText>
                      {entry.status === 'FAILED' && (
                        <PrivacySensitiveText className="block w-full truncate text-xs text-destructive">
                          {entry.reason}
                          {entry.code ? `（${entry.code}）` : ''}
                        </PrivacySensitiveText>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="max-w-[calc(100vw-2rem)] text-sm">
                    <PrivacySensitiveText className="block break-all">{entry.path}</PrivacySensitiveText>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {DELETE_KIND_LABELS[entry.kind]} · {DELETE_STATUS_LABELS[entry.status]}
                    </p>
                    <PrivacySensitiveText className="block text-xs text-muted-foreground">
                      {entry.reason}
                      {entry.code ? `（${entry.code}）` : ''}
                    </PrivacySensitiveText>
                  </PopoverContent>
                </Popover>
                <Badge
                  variant={entry.status === 'DELETED' ? 'success' : entry.status === 'FAILED' ? 'destructive' : 'muted'}
                >
                  {DELETE_STATUS_LABELS[entry.status]}
                </Badge>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="p-6 text-center text-sm text-muted-foreground">没有匹配的明细</p>
      )}
    </div>
  )
}
