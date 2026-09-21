'use client'

import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { ArchiveUploaderSourceList } from './archive-uploader-source-list'
import { isActiveArchiveUploaderRunStatus } from './archive-uploader-view-state'

type ListProps = ComponentProps<typeof ArchiveUploaderSourceList>
type Source = ListProps['sources'][number]
const selectable = (source: Source) =>
  source.status === 'ACTIVE' && !isActiveArchiveUploaderRunStatus(source.latestRun?.status)
const labels: Record<string, string> = {
  PENDING: '排队中',
  RUNNING: '扫描中',
  RETRY_WAIT: '等待下一轮',
  PAUSING: '正在暂停',
  PAUSED: '已暂停',
  CANCELLING: '正在取消',
  CANCELLED: '已取消',
  COMPLETED: '已完成',
  FAILED: '失败',
  SKIPPED: '已跳过'
}

export function ArchiveDiscoveryBatchSources({ allSources, ...listProps }: ListProps & { allSources: Source[] }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<{ sources: Source[]; requestId: string } | null>(null)
  const retryRequest = useRef<{ batchId: string; requestId: string } | null>(null)
  const batchQuery = useQuery(
    trpc.archiveSearch.activeBatchScan.queryOptions(undefined, {
      refetchInterval: (query) => (query.state.data?.active ? 3000 : false),
      refetchOnWindowFocus: true
    })
  )
  const batch = batchQuery.data
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.activeBatchScan.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listSources.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.getSource.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listItems.infiniteQueryKey() })
    ])
  }
  const previousProgress = useRef<string | null>(null)
  useEffect(() => {
    if (!batch) return
    const key = `${batch.id}:${batch.processed}:${batch.status}`
    if (previousProgress.current && previousProgress.current !== key) {
      void queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listSources.queryKey() })
      void queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.getSource.queryKey() })
      void queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listItems.infiniteQueryKey() })
    }
    previousProgress.current = key
  }, [batch, queryClient, trpc])
  const start = useMutation(
    trpc.archiveSearch.startBatchScan.mutationOptions({
      onSuccess: async () => {
        setDraft(null)
        setSelected(new Set())
        toast.success('批量扫描已创建，可关闭页面')
        await invalidate()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const control = useMutation(
    trpc.archiveSearch.controlBatchScan.mutationOptions({
      onSuccess: invalidate,
      onError: (error) => toast.error(error.message)
    })
  )
  const retry = useMutation(
    trpc.archiveSearch.retryBatchScan.mutationOptions({
      onSuccess: async () => {
        retryRequest.current = null
        await invalidate()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  useEffect(() => {
    setSelected(
      (current) =>
        new Set([...current].filter((id) => allSources.some((source) => source.id === id && selectable(source))))
    )
  }, [allSources])
  const visible = listProps.sources.filter(selectable)
  const chosen = allSources.filter((source) => selected.has(source.id))
  const hiddenCount = chosen.filter((source) => !listProps.sources.some(({ id }) => id === source.id)).length
  const allChecked = visible.length > 0 && visible.every(({ id }) => selected.has(id))
  const someChecked = visible.some(({ id }) => selected.has(id))
  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  const busy = start.isPending || control.isPending || retry.isPending
  const failedCount = batch?.results.filter(({ status }) => status === 'FAILED').length ?? 0
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {batchQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>批次状态加载失败</AlertTitle>
          <AlertDescription>
            <Button variant="outline" onClick={() => void batchQuery.refetch()}>
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {batch ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              批量扫描<Badge variant="secondary">{labels[batch.status] ?? batch.status}</Badge>
            </CardTitle>
            <CardDescription>
              已处理 {batch.processed} / {batch.total} 个来源
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Progress
              value={batch.total ? (batch.processed / batch.total) * 100 : 0}
              aria-label={`已处理 ${batch.processed} / ${batch.total} 个来源`}
            />
            <p className="text-sm text-muted-foreground">
              成功 {batch.results.filter(({ status }) => status === 'COMPLETED').length} · 失败 {failedCount} · 跳过{' '}
              {batch.results.filter(({ status }) => status === 'SKIPPED').length}
            </p>
            {batch.currentSourceId && batch.active ? (
              <p className="text-sm">
                <PrivacySensitiveText>
                  {batch.sources.find(({ id }) => id === batch.currentSourceId)?.name}
                </PrivacySensitiveText>{' '}
                · {batch.phase === 'LATEST' ? '追最新' : '补历史'} · 本轮已检查 {batch.checkedCount} 条
              </p>
            ) : null}
            {batch.status === 'PAUSING' ? (
              <p className="text-sm text-muted-foreground">当前轮次完成并保存游标后暂停。</p>
            ) : null}
            {batch.error ? <PrivacySensitiveText>{batch.error}</PrivacySensitiveText> : null}
            <div className="flex flex-wrap gap-2">
              {batch.active && !['PAUSED', 'PAUSING', 'CANCELLING'].includes(batch.status) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => control.mutate({ batchId: batch.id, command: 'PAUSE' })}
                >
                  暂停
                </Button>
              ) : null}
              {batch.status === 'PAUSED' ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => control.mutate({ batchId: batch.id, command: 'RESUME' })}
                >
                  继续
                </Button>
              ) : null}
              {batch.active ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || batch.status === 'CANCELLING'}
                  onClick={() => control.mutate({ batchId: batch.id, command: 'CANCEL' })}
                >
                  取消批次
                </Button>
              ) : null}
              {!batch.active && (failedCount > 0 || batch.status === 'FAILED') ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (retryRequest.current?.batchId !== batch.id) {
                      retryRequest.current = { batchId: batch.id, requestId: crypto.randomUUID() }
                    }
                    retry.mutate(retryRequest.current)
                  }}
                >
                  重试失败来源
                </Button>
              ) : null}
            </div>
            <details>
              <summary className="cursor-pointer text-sm">逐来源结果</summary>
              <ol className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
                {batch.sources.map((source, index) => {
                  const result = batch.results.find(({ sourceId }) => sourceId === source.id)
                  return (
                    <li key={source.id}>
                      <Button variant="link" size="sm" onClick={() => listProps.onSelect(source.id)}>
                        <PrivacySensitiveText>
                          {index + 1}. {source.name}
                        </PrivacySensitiveText>
                      </Button>
                      <span>
                        {result
                          ? labels[result.status]
                          : index === batch.processed && batch.active
                            ? '当前来源'
                            : '待处理'}
                      </span>
                      {result ? (
                        <PrivacySensitiveText className="block text-muted-foreground">
                          {result.message}
                        </PrivacySensitiveText>
                      ) : null}
                    </li>
                  )
                })}
              </ol>
            </details>
          </CardContent>
        </Card>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            aria-label="全选当前筛选的可扫描来源"
            checked={allChecked ? true : someChecked ? 'indeterminate' : false}
            disabled={visible.length === 0 || Boolean(batch?.active)}
            onCheckedChange={(checked) =>
              setSelected((current) => {
                const next = new Set(current)
                for (const source of visible) {
                  if (checked) next.add(source.id)
                  else next.delete(source.id)
                }
                return next
              })
            }
          />
          全选当前筛选
        </label>
        <span className="text-sm text-muted-foreground">
          已选 {chosen.length}
          {hiddenCount ? `（隐藏 ${hiddenCount}）` : ''}
        </span>
        {chosen.length ? (
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            清除
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={!chosen.length || Boolean(batch?.active) || batchQuery.isPending || batchQuery.isError || busy}
          onClick={() => setDraft({ sources: [...chosen], requestId: crypto.randomUUID() })}
        >
          批量扫描最新
        </Button>
      </div>
      {listProps.sources.length ? (
        <ArchiveUploaderSourceList
          {...listProps}
          checkedSourceIds={selected}
          onCheckSource={toggle}
          selectionDisabled={Boolean(batch?.active)}
        />
      ) : (
        <p className="text-sm text-muted-foreground">暂无此类型的发现来源</p>
      )}
      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open && !start.isPending) setDraft(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量扫描最新</DialogTitle>
            <DialogDescription>
              将按下列顺序扫描 {draft?.sources.length ?? 0}{' '}
              个来源。包含补全未扫描历史，首次扫描可能耗时较长。结果需人工挑选加入收件箱。
            </DialogDescription>
          </DialogHeader>
          <ol className="flex max-h-72 list-inside list-decimal flex-col gap-2 overflow-y-auto">
            {draft?.sources.map((source) => (
              <li key={source.id}>
                <PrivacySensitiveText>{source.displayName}</PrivacySensitiveText>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted-foreground">
            执行时已停用、删除或被其他扫描占用的来源将跳过。关闭页面后任务仍会继续。
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={start.isPending} onClick={() => setDraft(null)}>
              返回
            </Button>
            <Button
              disabled={start.isPending || !draft}
              onClick={() => {
                if (draft) start.mutate({ sourceIds: draft.sources.map(({ id }) => id), requestId: draft.requestId })
              }}
            >
              {start.isPending ? '正在创建…' : '开始扫描'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
