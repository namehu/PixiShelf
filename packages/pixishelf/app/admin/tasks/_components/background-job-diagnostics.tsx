'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { JobDto } from '@pixishelf/job-contracts'
import { AlertTriangle, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import type { DiagnosticItemView, DiagnosticReportView } from '@/services/background-task/job-diagnostic-service'
import { useOptionalBackgroundJobEventSubscription } from '../../_components/background-job-event-provider'
import { ACTIVE_JOB_STATUSES, formatBackgroundDate } from './background-task-format'

const stageLabels: Record<string, string> = {
  SOURCE_PAGE: '解析来源页',
  MEDIA_REQUEST: '请求媒体',
  MEDIA_STREAM: '下载媒体',
  MEDIA_VALIDATION: '校验媒体',
  STORAGE: '写入存储',
  PROXY_CONNECT: '连接代理',
  TLS_HANDSHAKE: 'TLS 握手',
  PROBE: '媒体探测',
  POSTER: '生成封面'
}
const sourceLabels: Record<DiagnosticReportView['source'], string> = {
  SNAPSHOT: '执行现场',
  LEGACY_CHECKPOINT: '当前保存的失败记录',
  LEGACY_SAMPLES: '历史失败样例',
  SUMMARY_ONLY: '仅有任务摘要'
}

export async function copyDiagnostic(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制脱敏诊断')
  } catch {
    toast.error('复制失败，请选择文本手动复制。')
  }
}

export function BackgroundJobDiagnostics({ job }: { job: JobDto }) {
  const trpc = useTRPC()
  const live = useOptionalBackgroundJobEventSubscription({ jobId: job.id })
  const [reportPages, setReportPages] = useState<string[]>([])
  const [selectedReport, setSelectedReport] = useState<string | undefined>()
  const [reason, setReason] = useState('all')
  const [pages, setPages] = useState<string[]>([])
  const [childPages, setChildPages] = useState<string[]>([])
  const active = ACTIVE_JOB_STATUSES.includes(job.status)
  const reports = useQuery(
    trpc.job.backgroundDiagnosticReports.queryOptions(
      { jobId: job.id, cursor: reportPages.at(-1), childCursor: childPages.at(-1), limit: 50 },
      { retry: false, refetchInterval: active && reportPages.length === 0 ? 5_000 : false }
    )
  )
  const report = reports.data?.items.find((entry) => entry.id === selectedReport) ?? reports.data?.items[0]
  const details = useQuery(
    trpc.job.backgroundDiagnosticItems.queryOptions(
      {
        jobId: job.id,
        reportId: report?.id ?? 'legacy',
        reason: reason === 'all' ? undefined : reason,
        cursor: pages.at(-1),
        limit: 50
      },
      { enabled: Boolean(report), retry: false, refetchInterval: active && report?.closedAt === null ? 5_000 : false }
    )
  )
  const latestLifecycle = live.items
    .filter(({ event }) => !['job.progress', 'job.stage_changed'].includes(event.type))
    .at(-1)?.event.id
  const lastLifecycle = useRef(latestLifecycle)
  useEffect(() => {
    if (latestLifecycle === lastLifecycle.current) return
    lastLifecycle.current = latestLifecycle
    void reports.refetch()
    if (report) void details.refetch()
  }, [latestLifecycle, reports.refetch, details.refetch, report?.id])
  useEffect(() => {
    void reports.refetch()
    if (report) void details.refetch()
  }, [job.status, reports.refetch, details.refetch, live.readyVersion, live.resetVersion, report?.id])
  useEffect(() => {
    setPages([])
    setReason('all')
  }, [report?.id])

  const summary = details.data?.summary ?? report
  const taskError = details.data?.taskError
  const children = reports.data?.failedChildren ?? 0
  const failed = Boolean(job.error || job.errorCode)
  if (!reports.isPending && !reports.isError && !report && children === 0) return null

  function changeReport(id: string) {
    setSelectedReport(id)
    setReason('all')
    setPages([])
  }
  const copySummary = () =>
    copyDiagnostic(
      [
        `任务 ${job.id}`,
        `报告 ${summary?.id ?? '未读取'} · 尝试 ${summary?.attempt ?? job.attempt}`,
        summary
          ? `${sourceLabels[summary.source]} · 失败项目 ${summary.totalKnown === false ? '总数未知' : summary.itemCount}${summary.source === 'SNAPSHOT' ? ` · 本次 ${summary.currentCount} · 遗留 ${summary.inheritedCount}` : ` · 已记录 ${summary.recordedCount}`}`
          : '',
        taskError?.message ?? job.error ?? '',
        summary?.expired ? '诊断明细已过期' : ''
      ]
        .filter(Boolean)
        .join('\n')
    )

  return (
    <section className="mt-4 flex min-w-0 flex-col gap-3" aria-label="失败诊断">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">失败诊断</h4>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={copySummary}>
            <Copy data-icon="inline-start" />
            复制摘要
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={reports.isFetching || details.isFetching}
            onClick={() => {
              void reports.refetch()
              if (report) void details.refetch()
            }}
          >
            <RefreshCw data-icon="inline-start" />
            刷新诊断
          </Button>
          {reports.data?.businessHref ? (
            <Button size="sm" variant="outline" asChild>
              <a href={reports.data.businessHref}>
                <ExternalLink data-icon="inline-start" />
                业务详情
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      {reports.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner />
          正在读取诊断…
        </p>
      ) : null}
      {reports.isError || details.isError ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>诊断读取失败</AlertTitle>
          <AlertDescription>
            请点击“刷新诊断”重试，已有任务记录仍保留。
            {failed ? <PrivacySensitiveText>{job.error}</PrivacySensitiveText> : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {summary ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={report?.id} onValueChange={changeReport}>
              <SelectTrigger aria-label="选择诊断执行" className="max-w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {reports.data?.items.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      尝试 {entry.attempt} · {formatBackgroundDate(entry.createdAt)} · {sourceLabels[entry.source]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {reportPages.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReportPages((value) => value.slice(0, -1))
                  changeReport('')
                }}
              >
                较新执行
              </Button>
            ) : null}
            {reports.data?.nextCursor ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReportPages((value) => [...value, reports.data!.nextCursor!])
                  changeReport('')
                }}
              >
                更早执行
              </Button>
            ) : null}
            {summary.outcome === 'COMPLETED' && summary.itemCount > 0 ? (
              <Badge variant="outline">完成但有失败项</Badge>
            ) : null}
          </div>
          {summary.expired ? (
            <Alert>
              <AlertTitle>诊断明细已过期</AlertTitle>
              <AlertDescription>失败现场保留 90 天；本次执行的计数和任务原有摘要仍然保留。</AlertDescription>
            </Alert>
          ) : null}
          {summary.expired && job.error ? (
            <PrivacySensitiveText as="p" className="select-text whitespace-pre-wrap break-words text-sm">
              任务原有摘要：{job.error}
            </PrivacySensitiveText>
          ) : null}
          {summary.source !== 'SNAPSHOT' ? (
            <Alert>
              <AlertTitle>{sourceLabels[summary.source]}</AlertTitle>
              <AlertDescription>
                {summary.source === 'LEGACY_CHECKPOINT'
                  ? '这些是目前尚存的领域检查点，可能包含前次遗留失败；不能还原每次历史执行。重试后记录可能变化。'
                  : summary.source === 'LEGACY_SAMPLES'
                    ? '旧执行只保存了部分失败样例，清单不代表全部失败。未记录的底层原因无法补回。'
                    : '旧执行未保存逐项失败现场；这里只能显示现存摘要，无法补回已丢失的原因。'}
              </AlertDescription>
            </Alert>
          ) : null}
          <p className="text-sm text-muted-foreground">
            失败项目 {summary.totalKnown === false ? '总数未知' : summary.itemCount}
            {summary.source === 'LEGACY_SAMPLES' ? ` · 已记录样例 ${summary.recordedCount}` : ''}
            {summary.source === 'SNAPSHOT'
              ? ` · 本次记录 ${summary.currentCount} · 前次遗留 ${summary.inheritedCount}`
              : ''}
            {summary.closedAt === null && summary.source === 'SNAPSHOT' ? ' · 执行中，记录持续更新' : ''}
          </p>
          {summary.source === 'SNAPSHOT' && !summary.complete && summary.closedAt ? (
            <Alert>
              <AlertTitle>执行中断，报告可能不完整</AlertTitle>
              <AlertDescription>已保存的失败现场仍可查看；尚未处理或尚未保存的项目不在本报告中。</AlertDescription>
            </Alert>
          ) : null}
          {taskError ? (
            <Alert variant={summary.outcome === 'COMPLETED' ? 'warning' : 'destructive'}>
              <AlertTriangle />
              <AlertTitle>
                <PrivacySensitiveText>{taskError.code}</PrivacySensitiveText>
              </AlertTitle>
              <AlertDescription>
                <PrivacySensitiveText className="whitespace-pre-wrap break-words">
                  {taskError.message}
                </PrivacySensitiveText>
                <DiagnosticEvidence item={taskError} />
              </AlertDescription>
            </Alert>
          ) : null}
          {!summary.expired && (details.data?.groups.length ?? 0) > 0 ? (
            <Select
              value={reason}
              onValueChange={(value) => {
                setReason(value)
                setPages([])
              }}
            >
              <SelectTrigger aria-label="筛选失败原因" className="max-w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部原因</SelectItem>
                  {details.data?.groups.map((group) => (
                    <SelectItem key={group.reasonKey} value={group.reasonKey}>
                      {group.reasonKey}（{group.count}）
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : null}
          {details.isPending && report ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Spinner />
              正在读取失败明细…
            </p>
          ) : null}
          <ol className="flex flex-col gap-2" aria-label="失败项目清单">
            {details.data?.items.map((item) => (
              <li key={item.id} className="min-w-0 rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <PrivacySensitiveText className="min-w-0 break-all text-sm font-medium">
                    {item.targetLabel ?? '任务对象'}
                  </PrivacySensitiveText>
                  {item.origin === 'INHERITED' ? <Badge variant="secondary">前次遗留</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  <PrivacySensitiveText>
                    {stageLabels[item.stage ?? ''] ?? item.stage ?? '未记录阶段'}
                  </PrivacySensitiveText>{' '}
                  · {formatBackgroundDate(item.createdAt)}
                  {item.itemAttempt != null ? ` · 项目尝试 ${item.itemAttempt}` : ''}
                </p>
                <PrivacySensitiveText as="p" className="mt-2 select-text whitespace-pre-wrap break-words text-sm">
                  {item.message}
                </PrivacySensitiveText>
                <DiagnosticEvidence item={item} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void copyDiagnostic(JSON.stringify({ jobId: job.id, reportId: summary.id, ...item }, null, 2))
                    }
                  >
                    <Copy data-icon="inline-start" />
                    复制此项诊断
                  </Button>
                  {item.href ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={item.href}>查看相关记录</a>
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {!summary.expired &&
          !details.isPending &&
          !details.isError &&
          details.data?.items.length === 0 &&
          summary.itemCount > 0 ? (
            <p className="text-sm text-muted-foreground">当前筛选下没有可用明细。旧记录可能已被重试更新。</p>
          ) : null}
          {pages.length > 0 || details.data?.nextCursor ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!pages.length || details.isFetching}
                onClick={() => setPages((value) => value.slice(0, -1))}
              >
                上一页
              </Button>
              <span className="text-xs text-muted-foreground">第 {pages.length + 1} 页 · 每页 50 项</span>
              <Button
                size="sm"
                variant="outline"
                disabled={!details.data?.nextCursor || details.isFetching}
                onClick={() => setPages((value) => [...value, details.data!.nextCursor!])}
              >
                下一页
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {children > 0 ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">失败子任务（{children}）</p>
          <ul className="flex flex-col gap-2">
            {reports.data?.childItems.map((child) => (
              <li key={child.id}>
                <a className="break-all underline" href={`/admin/tasks?jobId=${encodeURIComponent(child.id)}`}>
                  {child.type} · {child.id}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            {childPages.length ? (
              <Button size="sm" variant="outline" onClick={() => setChildPages((value) => value.slice(0, -1))}>
                上一批子任务
              </Button>
            ) : null}
            {reports.data?.nextChildCursor ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setChildPages((value) => [...value, reports.data!.nextChildCursor!])}
              >
                下一批子任务
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function DiagnosticEvidence({ item }: { item: DiagnosticItemView }) {
  return (
    <details className="mt-2 min-w-0 text-xs">
      <summary className="cursor-pointer select-none">技术证据与处理建议</summary>
      <div className="mt-2 flex flex-col gap-2">
        <PrivacySensitiveText as="pre" className="select-text whitespace-pre-wrap break-all">
          {JSON.stringify(
            {
              errorCode: item.code,
              stage: item.stage,
              remoteHost: item.remoteHost,
              httpStatus: item.httpStatus,
              causes: item.evidence
            },
            null,
            2
          )}
        </PrivacySensitiveText>
        <PrivacySensitiveText as="p">建议：{item.suggestion}</PrivacySensitiveText>
      </div>
    </details>
  )
}
