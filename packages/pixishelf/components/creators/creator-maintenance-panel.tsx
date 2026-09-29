'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import type { CreatorMaintenanceInput } from '@pixishelf/job-contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import MultipleSelector from '@/components/shared/multiple-selector'
import { CreatorPicker, type CreatorOption } from './creator-picker'
import { toast } from 'sonner'
import { CreatorReviewItem } from './creator-review-item'

const labels: Record<string, string> = {
  BACKFILL: '按原网站填写作者',
  ADD: '添加作者／社团',
  REMOVE: '移除作者／社团',
  SERIES: '加入系列',
  REMAP: '纠正网站作者名',
  PREPARING: '正在检查作品',
  READY: '请核对下面的修改',
  APPLYING: '执行中',
  COMPLETE: '已完成',
  PENDING: '待处理',
  SUCCESS: '成功',
  STALE: '作品信息已变，请重新检查',
  UNKNOWN: '未找到作者信息，请手动填写'
}

const explanations = {
  BACKFILL: '读取导入时保存的原网站作者和社团标签，填写到归档作品上。先列出修改内容，确认后才会保存。',
  ADD: '把下面选中的作者或社团添加到这些作品上。已有的其他作者会保留。',
  REMOVE: '从这些作品上移除下面选中的作者或社团。作品文件和作者资料都会保留，之后自动更新也不会把这位作者加回来。',
  SERIES: '把这些作品放进同一个系列，例如某部漫画的不同章节。加入系列不会改变作品的作者。'
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function CreatorMaintenancePanel({
  artworkIds = [],
  initialPlanId = '',
  onPlanChange
}: {
  artworkIds?: number[]
  initialPlanId?: string
  onPlanChange?: (planId: string) => void
}) {
  const trpc = useTRPC()
  const client = useTRPCClient()
  const queryClient = useQueryClient()
  const [command, setCommand] = useState<'BACKFILL' | 'ADD' | 'REMOVE' | 'SERIES'>('BACKFILL')
  const [section, setSection] = useState('automatic')
  const [creators, setCreators] = useState<CreatorOption[]>([])
  const [series, setSeries] = useState<{ id: number; name: string } | null>(null)
  const [planId, setPlanId] = useState(initialPlanId)
  const [afterId, setAfterId] = useState(0)
  const [mappingSearch, setMappingSearch] = useState('')
  const [mappingCursor, setMappingCursor] = useState<string>()
  const [mappingTarget, setMappingTarget] = useState<CreatorOption[]>([])
  const history = useQuery(trpc.creator.history.queryOptions(undefined, { refetchInterval: 5000 }))
  const state = useQuery(
    trpc.creator.status.queryOptions({ planId, afterId }, { enabled: !!planId, refetchInterval: 2500 })
  )
  const mappings = useQuery(trpc.creator.mappings.queryOptions({ search: mappingSearch, cursor: mappingCursor }))
  const prepare = useMutation(
    trpc.creator.prepare.mutationOptions({
      onSuccess: (result) => {
        setPlanId(result.planId)
        onPlanChange?.(result.planId)
        setAfterId(0)
        void history.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const apply = useMutation(
    trpc.creator.start.mutationOptions({
      onSuccess: () => {
        void state.refetch()
        toast.success('已提交，关闭页面不影响执行')
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const busy = prepare.isPending || apply.isPending
  function preview() {
    let input: CreatorMaintenanceInput
    if (command === 'BACKFILL') input = { command, ...(artworkIds.length ? { artworkIds } : {}) }
    else if (command === 'SERIES') {
      if (!series) return
      input = { command, artworkIds, seriesId: series.id }
    } else input = { command, artworkIds, creatorIds: creators.map((c) => c.id) }
    prepare.mutate(input)
  }
  async function jobAction(action: 'cancel' | 'retry' | 'pause' | 'resume') {
    if (!state.data?.job) return
    try {
      if (action === 'cancel') await client.job.cancelBackgroundJob.mutate({ jobId: state.data.job.id })
      else if (action === 'pause') await client.job.pauseBackgroundJob.mutate({ jobId: state.data.job.id })
      else if (action === 'resume') await client.job.resumeBackgroundJob.mutate({ jobId: state.data.job.id })
      else await client.job.retryBackgroundJob.mutate({ jobId: state.data.job.id })
      await state.refetch()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '任务操作失败')
    }
  }
  const total = state.data?.counts.reduce((sum, row) => sum + row._count, 0) ?? 0
  return (
    <div className="flex flex-col gap-5">
      <details open={!planId}>
        <summary className="cursor-pointer text-sm font-medium">
          {planId ? '开始新的检查（选择范围与操作）' : '选择怎么修改作者'}
        </summary>
        <Tabs
          className="mt-4"
          value={section}
          onValueChange={(value) => {
            setSection(value)
            if (value === 'automatic') setCommand('BACKFILL')
            if (value === 'manual') setCommand('ADD')
            if (value === 'series') setCommand('SERIES')
          }}
        >
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="automatic">自动填写作者</TabsTrigger>
            {artworkIds.length > 0 && <TabsTrigger value="manual">手动修改作者</TabsTrigger>}
            {artworkIds.length > 0 && <TabsTrigger value="series">加入系列</TabsTrigger>}
            <TabsTrigger value="mappings">纠正网站作者名</TabsTrigger>
          </TabsList>
          <TabsContent value={section === 'mappings' ? 'curation' : section}>
            <FieldGroup className="py-3">
              <Field>
                <FieldLabel>{labels[command]}</FieldLabel>
                <FieldDescription>{explanations[command]}</FieldDescription>
                <p>
                  {artworkIds.length
                    ? '本次选择了 ' +
                      artworkIds.length +
                      ' 件作品' +
                      (command === 'BACKFILL' ? '，只检查其中的归档作品。' : '。')
                    : '本次将检查全部归档作品。想先试几件？到作品管理中勾选作品，再点击「修改作者或加入系列」。'}
                </p>
              </Field>
              {section === 'manual' && (
                <Field>
                  <FieldLabel>怎么修改作者？</FieldLabel>
                  <Select value={command} onValueChange={(v) => setCommand(v as typeof command)}>
                    <SelectTrigger aria-label="怎么修改作者">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="ADD">添加作者／社团（保留已有作者）</SelectItem>
                        <SelectItem value="REMOVE">移除选错的作者／社团</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {(command === 'ADD' || command === 'REMOVE') && (
                <Field>
                  <FieldLabel>{command === 'REMOVE' ? '要移除谁？' : '这些作品是谁创作的？'}</FieldLabel>
                  <FieldDescription>可以选择多人。社团是共同创作或发布作品的团队。</FieldDescription>
                  <CreatorPicker value={creators} onChange={setCreators} />
                </Field>
              )}
              {command === 'SERIES' && (
                <Field>
                  <FieldLabel>系列</FieldLabel>
                  <MultipleSelector
                    value={series ? [{ value: String(series.id), label: series.name }] : []}
                    maxSelected={1}
                    triggerSearchOnFocus
                    onSearch={async (query) =>
                      (await client.series.list.query({ query })).items.map((s) => ({
                        value: String(s.id),
                        label: s.title
                      }))
                    }
                    onChange={(values) =>
                      setSeries(values[0] ? { id: Number(values[0].value), name: values[0].label } : null)
                    }
                    placeholder="搜索已有系列"
                  />
                  <Button asChild variant="link" className="self-start">
                    <Link href="/admin/series">创建系列或调整篇章顺序</Link>
                  </Button>
                </Field>
              )}
            </FieldGroup>
            <Button
              disabled={
                busy ||
                ((command === 'ADD' || command === 'REMOVE') && !creators.length) ||
                (command === 'SERIES' && !series)
              }
              onClick={preview}
            >
              {prepare.isPending ? '正在提交检查…' : '先看看会怎么改'}
            </Button>
          </TabsContent>
          <TabsContent value="mappings" className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              原网站的作者名认错人了，或者与收藏中已有的作者是同一个人时，在这里纠正。只有确认是同一位作者时才需要使用。
            </p>
            <Input
              aria-label="搜索网站作者名或收藏中的作者名"
              placeholder="搜索网站作者名或收藏中的作者名"
              value={mappingSearch}
              onChange={(e) => {
                setMappingSearch(e.target.value)
                setMappingCursor(undefined)
              }}
            />
            <Field>
              <FieldLabel>这些网站名称应该对应哪位作者／社团？</FieldLabel>
              <CreatorPicker value={mappingTarget} onChange={setMappingTarget} maxSelected={1} />
              <FieldDescription>
                选好后，在下面找到要纠正的网站名称。这会更新使用该名称的历史作品，也用于以后导入的作品。
              </FieldDescription>
            </Field>
            {mappings.data?.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {mappingSearch
                  ? '没有找到这个名称，试试其他关键词。'
                  : '还没有保存网站作者名。可以先到「自动填写作者」检查归档作品，并确认保存。'}
              </p>
            )}
            {mappings.data?.items.map((mapping) => (
              <div key={mapping.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
                <PrivacySensitiveText>
                  网站{mapping.namespace === 'group' ? '社团' : '作者'}名：{mapping.sourceName} → 收藏中的
                  {mapping.namespace === 'group' ? '社团' : '作者'}：{mapping.artist.name}
                </PrivacySensitiveText>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !mappingTarget[0]}
                  onClick={() =>
                    prepare.mutate({
                      command: 'REMAP',
                      mappingId: mapping.id,
                      expectedVersion: mapping.version,
                      artistId: mappingTarget[0]!.id
                    })
                  }
                >
                  查看改成此人的影响
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!mappingCursor} onClick={() => setMappingCursor(undefined)}>
                第一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!mappings.data?.nextCursor}
                onClick={() => setMappingCursor(mappings.data?.nextCursor ?? undefined)}
              >
                下一页
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </details>
      <Field>
        <FieldLabel>检查记录</FieldLabel>
        <Select
          value={planId}
          onValueChange={(value) => {
            setPlanId(value)
            onPlanChange?.(value)
            setAfterId(0)
          }}
        >
          <SelectTrigger aria-label="选择整理记录">
            <SelectValue placeholder="查看之前的检查或修改结果" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {history.data?.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {labels[plan.command] ?? plan.command} · {new Date(plan.createdAt).toLocaleString()}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      {state.data && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{labels[state.data.plan.command]} · 检查结果</h2>
          {state.data.plan.status === 'READY' && (
            <Alert>
              <AlertDescription>
                下面是这次准备修改的内容，目前还没有保存。确认会应用整份列表；如果有认错的作品，请先回作品管理缩小选择范围，再重新检查。
              </AlertDescription>
            </Alert>
          )}
          {['READY', 'COMPLETE'].includes(state.data.plan.status) && total === 0 && (
            <p>没有找到可以处理的作品，请检查选择范围。</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{labels[state.data.plan.status] ?? state.data.plan.status}</Badge>
            <span>共 {total} 项</span>
            {state.data.plan.status !== 'READY' &&
              state.data.counts.map((row) => (
                <Badge key={row.status} variant="outline">
                  {labels[row.status] ?? row.status}: {row._count}
                </Badge>
              ))}
          </div>
          <PrivacySensitiveText>{state.data.job?.error}</PrivacySensitiveText>
          <div className="flex flex-wrap gap-2">
            {state.data.plan.status === 'READY' && (
              <Button
                disabled={busy || !total}
                onClick={() => apply.mutate({ planId, fingerprint: state.data!.plan.fingerprint })}
              >
                确认修改全部 {total} 项
              </Button>
            )}
            {state.data.job && ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'].includes(state.data.job.status) && (
              <Button variant="outline" onClick={() => void jobAction('cancel')}>
                停止后续处理
              </Button>
            )}
            {state.data.job && ['FAILED', 'CANCELLED'].includes(state.data.job.status) && (
              <Button variant="outline" onClick={() => void jobAction('retry')}>
                重试剩余作品
              </Button>
            )}
            {state.data.job?.status === 'RUNNING' && (
              <Button variant="outline" onClick={() => void jobAction('pause')}>
                暂停处理
              </Button>
            )}
            {state.data.job?.status === 'PAUSED' && (
              <Button variant="outline" onClick={() => void jobAction('resume')}>
                继续处理
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                void queryClient.invalidateQueries()
                void mappings.refetch()
              }}
            >
              刷新结果
            </Button>
          </div>
          {state.data.plan.status === 'APPLYING' && (
            <p className="text-sm text-muted-foreground">
              关闭页面后会继续处理。暂停或停止只影响剩余作品，已保存的修改会保留。
            </p>
          )}
          {state.data.items.map((item) => {
            const payload = object(item.payload)
            const result = object(item.result)
            return (
              <div key={item.id}>
                <CreatorReviewItem
                  title={String(payload.title ?? payload.sourceName ?? item.artworkId)}
                  artworkId={item.artworkId}
                  command={state.data!.plan.command}
                  status={item.status}
                  planStatus={state.data!.plan.status}
                  review={item.review}
                  reason={String(result.reason ?? '')}
                />
                {typeof result.previousArtistId === 'number' && typeof payload.mappingId === 'string' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const mapping = await client.creator.mapping.query({ id: payload.mappingId as string })
                        if (!mapping) throw new Error('映射已不存在')
                        prepare.mutate({
                          command: 'REMAP',
                          mappingId: mapping.id,
                          expectedVersion: mapping.version,
                          artistId: result.previousArtistId as number
                        })
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : '无法预览恢复')
                      }
                    }}
                  >
                    查看改回原作者的影响
                  </Button>
                )}
              </div>
            )
          })}
          <div className="flex gap-2">
            <Button variant="outline" disabled={!afterId} onClick={() => setAfterId(0)}>
              第一页
            </Button>
            <Button
              variant="outline"
              disabled={!state.data.nextCursor}
              onClick={() => setAfterId(state.data!.nextCursor!)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
