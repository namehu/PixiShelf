'use client'

import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import {
  ArrowRight,
  Check,
  Clipboard,
  Clock3,
  FileJson2,
  History,
  Minus,
  Plus,
  ShieldCheck
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useTRPC } from '@/lib/trpc'
import type { AppRouter } from '@/server'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

const HISTORY_PAGE_SIZE = 20

type RouterOutputs = inferRouterOutputs<AppRouter>
type Report = RouterOutputs['artwork']['pixivSyncReport']
type ReportSummary = RouterOutputs['artwork']['pixivSyncReportHistory']['items'][number]
type ReportValue = Report['fields'][number]['before']
type SnapshotOutput = RouterOutputs['artwork']['pixivSyncSnapshot']
type DetailTab = 'changes' | 'before' | 'after'
type JsonMode = 'raw' | 'normalized'

const FIELD_LABELS: Record<Report['fields'][number]['key'], string> = {
  title: '标题',
  description: '描述',
  titleOverridden: '标题人工覆盖',
  descriptionOverridden: '描述人工覆盖',
  bookmarkCount: '收藏数',
  isAiGenerated: 'AI 生成标记',
  originalUrl: '原图链接',
  size: '作品尺寸',
  sourceDate: '来源日期',
  sourceUrl: 'Pixiv 作品链接',
  thumbnailUrl: '缩略图链接',
  xRestrict: '内容限制',
  pixivAiType: 'Pixiv AI 类型',
  pixivType: 'Pixiv 作品类型',
  sanityLevel: 'Sanity 等级'
}

export function PixivArtworkSyncReportDrawer({
  artwork,
  onOpenChange
}: {
  artwork: ArtworkResponseDto | null
  onOpenChange: (open: boolean) => void
}) {
  const trpc = useTRPC()
  const open = Boolean(artwork)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('changes')
  const [jsonMode, setJsonMode] = useState<JsonMode>('normalized')

  useEffect(() => {
    setSelectedReportId(null)
    setActiveTab('changes')
    setJsonMode('normalized')
  }, [artwork?.id])

  const historyQuery = useInfiniteQuery(
    trpc.artwork.pixivSyncReportHistory.infiniteQueryOptions(
      { artworkId: artwork?.id ?? 0, limit: HISTORY_PAGE_SIZE },
      {
        initialCursor: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: open && Boolean(artwork?.pixivEligible)
      }
    )
  )
  const reports = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [historyQuery.data]
  )

  useEffect(() => {
    if (!selectedReportId && reports[0]) setSelectedReportId(reports[0].id)
  }, [reports, selectedReportId])

  const reportQuery = useQuery(
    trpc.artwork.pixivSyncReport.queryOptions(
      { artworkId: artwork?.id ?? 0, reportId: selectedReportId ?? '' },
      { enabled: open && Boolean(artwork && selectedReportId) }
    )
  )
  const report = reportQuery.data
  const sameSnapshot = Boolean(
    report?.snapshots.before && report.snapshots.before.hash === report.snapshots.after.hash
  )
  const requestedSnapshotSide = activeTab === 'before' && !sameSnapshot ? 'before' : 'after'
  const snapshotQuery = useQuery(
    trpc.artwork.pixivSyncSnapshot.queryOptions(
      {
        artworkId: artwork?.id ?? 0,
        reportId: selectedReportId ?? '',
        side: requestedSnapshotSide
      },
      { enabled: open && Boolean(selectedReportId) && activeTab !== 'changes' }
    )
  )

  const handleCopyJson = async () => {
    const value = snapshotQuery.data?.available ? selectSnapshotJson(snapshotQuery.data.content, jsonMode) : null
    if (value === null) return
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
    toast.success(`已复制${jsonMode === 'raw' ? '原始' : '规范化'} JSON`)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(96vw,1120px)] gap-0 p-0 sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4 pr-14">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="truncate text-lg">Pixiv 同步记录</SheetTitle>
              <PrivacySensitiveText as={SheetDescription} className="mt-1 truncate">
                {artwork ? `${artwork.title} · Pixiv ${artwork.pixivArtworkId ?? '身份不可用'}` : '作品同步详情'}
              </PrivacySensitiveText>
            </div>
            {report ? <ChangeKindBadge kind={report.changeKind} /> : null}
          </div>
        </SheetHeader>

        {!artwork?.pixivEligible ? (
          <DrawerState title="无法读取同步记录" description="该作品没有唯一且有效的 Pixiv 身份。" />
        ) : historyQuery.isLoading ? (
          <DrawerLoading label="正在读取同步历史" />
        ) : historyQuery.isError ? (
          <DrawerState title="同步历史读取失败" description={historyQuery.error.message} destructive />
        ) : reports.length === 0 ? (
          <DrawerState
            title="暂无详细同步报告"
            description="该作品可能尚未同步，或最近一次同步发生在报告功能上线之前。重新同步后会生成第一份报告。"
          />
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[270px_minmax(0,1fr)] lg:grid-rows-1">
            <ReportTimeline
              reports={reports}
              selectedReportId={selectedReportId}
              onSelect={(reportId) => {
                setSelectedReportId(reportId)
                setActiveTab('changes')
              }}
              hasNextPage={historyQuery.hasNextPage}
              loadingMore={historyQuery.isFetchingNextPage}
              onLoadMore={() => historyQuery.fetchNextPage()}
            />

            <div className="min-h-0 min-w-0 bg-muted/10">
              {reportQuery.isLoading ? (
                <DrawerLoading label="正在读取变更报告" />
              ) : reportQuery.isError ? (
                <DrawerState title="变更报告读取失败" description={reportQuery.error.message} destructive />
              ) : report ? (
                <Tabs
                  value={activeTab}
                  onValueChange={(value) => setActiveTab(value as DetailTab)}
                  className="h-full min-h-0 gap-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-3 sm:px-6">
                    <TabsList className="max-w-full overflow-x-auto">
                      <TabsTrigger value="changes">变更摘要</TabsTrigger>
                      <TabsTrigger value="before">同步前 JSON</TabsTrigger>
                      <TabsTrigger value="after">同步后 JSON</TabsTrigger>
                    </TabsList>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(report.checkedAt)}
                    </span>
                  </div>
                  <TabsContent value="changes" className="min-h-0 overflow-hidden">
                    <ReportChanges report={report} />
                  </TabsContent>
                  <TabsContent value="before" className="min-h-0 overflow-hidden">
                    <SnapshotPanel
                      side="before"
                      sameSnapshot={sameSnapshot}
                      query={snapshotQuery}
                      mode={jsonMode}
                      onModeChange={setJsonMode}
                      onCopy={handleCopyJson}
                    />
                  </TabsContent>
                  <TabsContent value="after" className="min-h-0 overflow-hidden">
                    <SnapshotPanel
                      side="after"
                      sameSnapshot={sameSnapshot}
                      query={snapshotQuery}
                      mode={jsonMode}
                      onModeChange={setJsonMode}
                      onCopy={handleCopyJson}
                    />
                  </TabsContent>
                </Tabs>
              ) : null}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ReportTimeline({
  reports,
  selectedReportId,
  onSelect,
  hasNextPage,
  loadingMore,
  onLoadMore
}: {
  reports: ReportSummary[]
  selectedReportId: string | null
  onSelect: (reportId: string) => void
  hasNextPage: boolean
  loadingMore: boolean
  onLoadMore: () => void
}) {
  return (
    <div className="min-h-0 border-b bg-background lg:border-r lg:border-b-0">
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
        <History className="size-4 text-muted-foreground" aria-hidden="true" />
        完整同步历史
      </div>
      <ScrollArea className="h-44 lg:h-[calc(100%-49px)]">
        <div className="flex gap-2 p-3 lg:flex-col">
          {reports.map((report, index) => (
            <button
              key={report.id}
              type="button"
              onClick={() => onSelect(report.id)}
              className={cn(
                'relative min-w-56 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:min-w-0',
                selectedReportId === report.id
                  ? 'border-primary/50 bg-primary/5 shadow-sm'
                  : 'border-transparent bg-muted/35 hover:border-border hover:bg-muted/60'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <ChangeKindBadge kind={report.changeKind} compact />
                {index === 0 ? <span className="text-[10px] text-muted-foreground">最新</span> : null}
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 className="size-3" aria-hidden="true" />
                {formatDateTime(report.checkedAt)}
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">
                字段 {report.fieldCount} · 标签 +{report.addedTagCount}/-{report.removedTagCount}
              </div>
            </button>
          ))}
          {hasNextPage ? (
            <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={loadingMore} className="shrink-0">
              {loadingMore ? <Spinner data-icon="inline-start" /> : null}
              加载更早记录
            </Button>
          ) : null}
        </div>
        <ScrollBar orientation="horizontal" className="lg:hidden" />
      </ScrollArea>
    </div>
  )
}

function ReportChanges({ report }: { report: Report }) {
  const tagChanged = report.tags.added.length > 0 || report.tags.removed.length > 0
  const nothingChanged = report.fields.length === 0 && !tagChanged
  return (
    <ScrollArea className="h-full">
      <div className="grid gap-5 p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <EvidenceCard label="字段变化" value={report.fields.length} />
          <EvidenceCard label="新增标签" value={report.tags.added.length} tone="added" />
          <EvidenceCard label="移除标签" value={report.tags.removed.length} tone="removed" />
        </div>

        {nothingChanged ? (
          <Alert>
            <Check aria-hidden="true" />
            <AlertTitle>{report.changeKind === 'SNAPSHOT_ONLY' ? '数据库内容无变化' : '本次内容完全一致'}</AlertTitle>
            <AlertDescription>
              {report.changeKind === 'SNAPSHOT_ONLY'
                ? '远端稳定快照发生变化，但映射到 PixiShelf 的字段与标签没有改变。'
                : '同步前后的来源字段、标签和稳定快照均一致。'}
            </AlertDescription>
          </Alert>
        ) : null}

        {report.fields.length > 0 ? (
          <section className="grid gap-3">
            <SectionHeading title="作品字段" description="仅列出实际发生变化的字段" />
            <div className="grid gap-3">
              {report.fields.map((field) => (
                <FieldDiff key={field.key} label={FIELD_LABELS[field.key]} before={field.before} after={field.after} />
              ))}
            </div>
          </section>
        ) : null}

        {tagChanged ? (
          <section className="grid gap-3">
            <SectionHeading title="来源标签" description="只反映当前 Pixiv 引用拥有的 SOURCE 标签" />
            <div className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2">
              <TagChangeList title="新增" tags={report.tags.added} icon="plus" />
              <TagChangeList title="移除" tags={report.tags.removed} icon="minus" />
            </div>
          </section>
        ) : null}

        {report.protectedFields.length > 0 ? (
          <Alert variant="warning">
            <ShieldCheck aria-hidden="true" />
            <AlertTitle>保留了任务期间的人工修改</AlertTitle>
            <AlertDescription>
              {report.protectedFields.map((field) => FIELD_LABELS[field]).join('、')} 没有被旧响应覆盖。
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-3">
          <SectionHeading title="快照证据" description="完整 JSON 保存在 pixiv_data，数据库只保留当前指针" />
          <div className="grid gap-2 rounded-xl border bg-background p-4 text-xs sm:grid-cols-2">
            <SnapshotReference label="同步前" snapshot={report.snapshots.before} />
            <SnapshotReference label="同步后" snapshot={report.snapshots.after} />
          </div>
        </section>
      </div>
    </ScrollArea>
  )
}

function FieldDiff({ label, before, after }: { label: string; before: ReportValue; after: ReportValue }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="mb-3 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <DiffValue label="同步前" value={before} />
        <div className="flex items-center justify-center text-muted-foreground">
          <ArrowRight className="size-4 rotate-90 sm:rotate-0" aria-hidden="true" />
        </div>
        <DiffValue label="同步后" value={after} />
      </div>
    </div>
  )
}

function DiffValue({ label, value }: { label: string; value: ReportValue }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/45 p-3">
      <div className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <PrivacySensitiveText as="div" className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-sm">
        {formatReportValue(value)}
      </PrivacySensitiveText>
      {value.truncated ? (
        <div className="mt-2 text-[10px] text-muted-foreground">
          已显示前 {String(value.value).length} / {value.originalLength} 字符 · SHA-256 {value.sha256?.slice(0, 12)}…
        </div>
      ) : null}
    </div>
  )
}

function SnapshotPanel({
  side,
  sameSnapshot,
  query,
  mode,
  onModeChange,
  onCopy
}: {
  side: 'before' | 'after'
  sameSnapshot: boolean
  query: {
    isLoading: boolean
    isError: boolean
    error: { message: string } | null
    data: SnapshotOutput | undefined
  }
  mode: JsonMode
  onModeChange: (mode: JsonMode) => void
  onCopy: () => void
}) {
  if (query.isLoading) return <DrawerLoading label="正在读取完整 JSON" />
  if (query.isError) {
    return <DrawerState title="JSON 快照读取失败" description={query.error?.message ?? '快照读取失败'} destructive />
  }
  if (!query.data?.available) {
    return (
      <DrawerState
        title={side === 'before' ? '没有同步前快照' : '快照文件不可用'}
        description={
          query.data?.reason === 'SNAPSHOT_MISSING'
            ? '数据库记录仍存在，但对应的 pixiv_data 文件已经缺失。请检查挂载和备份。'
            : '这是该作品的第一份在线同步快照。'
        }
      />
    )
  }
  const value = selectSnapshotJson(query.data.content, mode)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-background px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2">
          <Button variant={mode === 'normalized' ? 'secondary' : 'ghost'} size="sm" onClick={() => onModeChange('normalized')}>
            normalized
          </Button>
          <Button variant={mode === 'raw' ? 'secondary' : 'ghost'} size="sm" onClick={() => onModeChange('raw')}>
            raw
          </Button>
          {sameSnapshot ? <Badge variant="outline">前后快照相同</Badge> : null}
        </div>
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Clipboard data-icon="inline-start" aria-hidden="true" />
          复制 JSON
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 bg-zinc-950">
        <PrivacySensitiveText
          as="pre"
          className="min-w-max p-4 font-mono text-xs leading-5 text-zinc-100 sm:p-6"
        >
          {JSON.stringify(value, null, 2)}
        </PrivacySensitiveText>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  )
}

function ChangeKindBadge({ kind, compact = false }: { kind: Report['changeKind']; compact?: boolean }) {
  const display = {
    UPDATED: { label: '有更新', variant: 'success' as const },
    SNAPSHOT_ONLY: { label: '仅快照变化', variant: 'secondary' as const },
    UNCHANGED: { label: '无变化', variant: 'outline' as const },
    PARTIAL: { label: '部分更新', variant: 'warning' as const }
  }[kind]
  return (
    <Badge variant={display.variant} className={compact ? 'text-[10px]' : undefined}>
      {display.label}
    </Badge>
  )
}

function EvidenceCard({ label, value, tone }: { label: string; value: number; tone?: 'added' | 'removed' }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 font-mono text-2xl font-semibold tabular-nums',
          tone === 'added' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'removed' && 'text-rose-600 dark:text-rose-400'
        )}
      >
        {value}
      </div>
    </div>
  )
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function TagChangeList({ title, tags, icon }: { title: string; tags: string[]; icon: 'plus' | 'minus' }) {
  const Icon = icon === 'plus' ? Plus : Minus
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {title}（{tags.length}）
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.length ? (
          tags.map((tag) => (
            <Badge key={tag} variant="outline">
              <PrivacySensitiveText>{tag}</PrivacySensitiveText>
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">无</span>
        )}
      </div>
    </div>
  )
}

function SnapshotReference({
  label,
  snapshot
}: {
  label: string
  snapshot: Report['snapshots']['before'] | Report['snapshots']['after']
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/40 p-3">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <FileJson2 className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      {snapshot ? (
        <>
          <div className="truncate font-mono" title={snapshot.hash}>{snapshot.hash}</div>
          <PrivacySensitiveText as="div" className="mt-1 truncate text-muted-foreground">
            {snapshot.path}
          </PrivacySensitiveText>
        </>
      ) : (
        <div className="text-muted-foreground">首次同步，无上一版</div>
      )}
    </div>
  )
}

function DrawerLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-52 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      {label}
    </div>
  )
}

function DrawerState({ title, description, destructive = false }: { title: string; description: string; destructive?: boolean }) {
  return (
    <div className="flex flex-1 items-start justify-center p-6 sm:p-10">
      <Alert variant={destructive ? 'destructive' : 'default'} className="max-w-xl">
        <FileJson2 aria-hidden="true" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          {destructive ? <PrivacySensitiveText>{description}</PrivacySensitiveText> : description}
        </AlertDescription>
      </Alert>
    </div>
  )
}

function formatReportValue(value: ReportValue) {
  if (value.value === null) return '空'
  if (typeof value.value === 'boolean') return value.value ? '是' : '否'
  return String(value.value)
}

function selectSnapshotJson(content: unknown, mode: JsonMode) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null
  return (content as Record<string, unknown>)[mode] ?? null
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value))
}
