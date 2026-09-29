'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, FileClock } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
      <SheetContent className="w-full sm:max-w-4xl">
        {report ? <ReportContent key={report.reportId} report={report} onClose={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function ReportContent({ report, onClose }: { report: ArtworkDeleteReport; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const filtered = useMemo(
    () =>
      report.entries.filter(
        (entry) =>
          (status === 'all' || entry.status === status) &&
          entry.path.toLocaleLowerCase().includes(search.toLocaleLowerCase())
      ),
    [report.entries, search, status]
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50))
  const currentPage = Math.min(page, pageCount - 1)
  const entries = filtered.slice(currentPage * 50, currentPage * 50 + 50)
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
      <SheetHeader className="pr-12">
        <SheetTitle>删除总结</SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-col gap-1">
            <PrivacySensitiveText>
              {report.artwork.title} · 作品 #{report.artwork.id}
            </PrivacySensitiveText>
            <span>
              {new Date(report.finishedAt).toLocaleString()} · {report.artwork.createdVia}
            </span>
            <PrivacySensitiveText className="break-all">
              作品目录：{report.artwork.directory ?? '未确定'}
            </PrivacySensitiveText>
          </div>
        </SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        <div role="status" aria-live="polite" aria-atomic="true" className="flex flex-wrap items-center gap-2">
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
          <span>
            已删除媒体 {report.counts.media} · 附属文件 {report.counts.sidecars} · 目录 {report.counts.directories}
          </span>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="其他执行结果">
          <Badge variant="muted">原本不存在 {report.counts.missing}</Badge>
          <Badge variant="muted">保留 {report.counts.retained}</Badge>
          <Badge variant={report.counts.failed ? 'destructive' : 'muted'}>失败 {report.counts.failed}</Badge>
          <Badge variant="muted">未执行 {report.counts.notAttempted}</Badge>
        </div>
        {report.warnings.length > 0 || !report.inspectionComplete ? (
          <Alert variant={report.outcome === 'FAILED' ? 'destructive' : 'default'}>
            <AlertTitle>{report.mode === 'ARCHIVE_TRASH' ? '归档回收' : '执行说明'}</AlertTitle>
            <AlertDescription>
              {report.warnings.map((warning, index) => (
                <PrivacySensitiveText as="p" key={index}>
                  {warning}
                </PrivacySensitiveText>
              ))}
              {!report.inspectionComplete && report.mode === 'DIRECT_DELETE' ? (
                <p>目录内部未完整检查，未列出的内容不代表已经删除。</p>
              ) : null}
              {report.archive?.jobId ? (
                <Button asChild variant="link">
                  <Link
                    href={`/admin/tasks?jobId=${encodeURIComponent(report.archive.jobId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看回收任务
                  </Link>
                </Button>
              ) : null}
              {report.archive ? (
                <span>
                  当前状态：{report.archive.lifecycleState}
                  {report.archive.reused ? '（复用已有回收请求）' : ''}
                </span>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <section aria-label="数据库结果" className="flex flex-col gap-2">
          <h3 className="font-medium">数据库结果</h3>
          <p>
            作品记录：{DELETE_STATUS_LABELS[report.database.artwork]}；媒体记录：
            {DELETE_STATUS_LABELS[report.database.media]}，实际删除 {report.database.deletedMediaCount} 条。
          </p>
          {report.database.relatedRecords.map((text) => (
            <p key={text} className="text-sm text-muted-foreground">
              {text}
            </p>
          ))}
          <p className="text-sm text-muted-foreground">标签、艺术家和系列实体本身保留。</p>
        </section>
        <section aria-label="文件与目录明细" className="flex flex-col gap-3">
          <h3 className="font-medium">文件与目录明细</h3>
          <p className="text-sm text-muted-foreground">路径相对扫描根目录。每项显示实际结果及删除依据。</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="delete-report-search">搜索路径</FieldLabel>
              <Input
                id="delete-report-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(0)
                }}
              />
            </Field>
            <Field className="sm:w-44">
              <FieldLabel htmlFor="delete-report-status">执行结果</FieldLabel>
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value)
                  setPage(0)
                }}
              >
                <SelectTrigger id="delete-report-status">
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
            </Field>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>路径</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>结果</TableHead>
                <TableHead>依据或原因</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={`${entry.kind}:${entry.path}`}>
                  <TableCell className="min-w-36 max-w-80 whitespace-normal break-all">
                    <PrivacySensitiveText>{entry.path}</PrivacySensitiveText>
                  </TableCell>
                  <TableCell>{DELETE_KIND_LABELS[entry.kind]}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        entry.status === 'DELETED' ? 'success' : entry.status === 'FAILED' ? 'destructive' : 'muted'
                      }
                    >
                      {DELETE_STATUS_LABELS[entry.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="min-w-40 max-w-72 whitespace-normal">
                    <PrivacySensitiveText>
                      {entry.reason}
                      {entry.code ? `（${entry.code}）` : ''}
                    </PrivacySensitiveText>
                  </TableCell>
                </TableRow>
              ))}
              {!entries.length ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    {report.entries.length ? '没有匹配的明细。' : '本次请求没有物理文件或目录操作。'}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              共 {filtered.length} 项 · 第 {currentPage + 1} / {pageCount} 页
            </span>
            <div className="flex gap-2">
              <Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={currentPage + 1 >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </section>
        <p className="break-all text-xs text-muted-foreground">报告编号：{report.reportId}</p>
      </div>
      <SheetFooter>
        <p className="text-sm text-muted-foreground">
          仅保留本页最近一次总结，刷新或离开后清除。下载包含全部明细和真实路径，不受筛选或隐私遮蔽影响。
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={download}>
            <Download data-icon="inline-start" aria-hidden="true" />
            下载完整总结
          </Button>
          <Button onClick={onClose}>
            <FileClock data-icon="inline-start" aria-hidden="true" />
            关闭总结
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}
