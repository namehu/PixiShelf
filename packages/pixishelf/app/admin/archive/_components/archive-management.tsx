'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import {
  Archive,
  CirclePause,
  CirclePlay,
  ExternalLink,
  Loader2,
  Images,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import type { AppRouter } from '@/server'
import { ArchiveItemDrawer } from './archive-item-drawer'

const ACTIVE_STATUSES = new Set(['PENDING', 'RUNNING', 'CANCELLING'])
type RouterOutputs = inferRouterOutputs<AppRouter>
type ArchivePreviewOutput = RouterOutputs['archive']['preview']
type ArchiveTaskOutput = RouterOutputs['archive']['listTasks'][number]

export function ArchiveManagement() {
  const trpc = useTRPC()
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<ArchivePreviewOutput | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [detailRefreshVersion, setDetailRefreshVersion] = useState(0)
  const tasksQuery = useQuery(
    trpc.archive.listTasks.queryOptions(
      { limit: 30 },
      {
        refetchInterval: (query) => {
          const tasks = (query.state.data ?? []) as Array<{ status: string }>
          return tasks.some((task) => ACTIVE_STATUSES.has(task.status)) ? 1500 : 5000
        }
      }
    )
  )
  const previewMutation = useMutation(
    trpc.archive.preview.mutationOptions({
      onSuccess: (data) => setPreview(data),
      onError: (error) => toast.error(error.message)
    })
  )
  const enqueueMutation = useMutation(
    trpc.archive.enqueue.mutationOptions({
      onSuccess: async (result) => {
        toast.success(result.reused ? '已打开现有活动任务' : '归档任务已进入队列')
        setPreview(null)
        setUrl('')
        await tasksQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const actionMutation = useMutation(
    trpc.archive.action.mutationOptions({
      onSuccess: async () => {
        await tasksQuery.refetch()
        setDetailRefreshVersion((value) => value + 1)
      },
      onError: (error) => toast.error(error.message)
    })
  )

  const submitPreview = () => {
    const value = url.trim()
    if (!value) return
    previewMutation.mutate({ url: value })
  }

  const detailTask = tasksQuery.data?.find((task) => task.id === detailTaskId) ?? null

  return (
    <div className="p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">链接归档</h1>
          <p className="text-sm text-muted-foreground">
            粘贴一个公开 E-Hentai 画廊或图片页链接，预览后由独立 Worker 下载、校验并发布到作品库。
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">解析作品链接</CardTitle>
            <CardDescription>
              首版仅支持 e-hentai.org 的 /g/... 和 /s/... HTTPS 链接，不使用账号 Cookie。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault()
                submitPreview()
              }}
            >
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://e-hentai.org/g/1234567/token/"
                autoComplete="off"
                disabled={previewMutation.isPending}
              />
              <Button type="submit" disabled={!url.trim() || previewMutation.isPending}>
                {previewMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                解析预览
              </Button>
            </form>
            {preview && (
              <div className="rounded-lg border bg-muted/10 p-4">
                <div className="flex flex-col gap-4 sm:flex-row">
                  {preview.thumbnailUrl ? (
                    <img
                      src={preview.thumbnailUrl}
                      alt="远端封面"
                      className="h-40 w-28 shrink-0 rounded-md border bg-muted object-cover"
                    />
                  ) : (
                    <div className="flex h-40 w-28 shrink-0 items-center justify-center rounded-md border bg-muted">
                      <Archive className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">{preview.title}</h2>
                        {preview.isUpdate && <Badge variant="secondary">已有归档 / 更新</Badge>}
                        {preview.activeTaskId && <Badge variant="outline">已有活动任务</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        E-Hentai #{preview.externalId} · {preview.pageCount} 张 · {preview.category || '未分类'}
                        {preview.uploader ? ` · 上传者 ${preview.uploader}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">存储分桶：{preview.creatorBucket}</p>
                    </div>
                    {preview.titleAliases.length > 0 && (
                      <p className="text-sm text-muted-foreground">别名：{preview.titleAliases.join(' / ')}</p>
                    )}
                    <div className="flex max-h-24 flex-wrap gap-1 overflow-auto">
                      {preview.tags.slice(0, 30).map((tag) => (
                        <Badge key={`${tag.namespace}:${tag.name}`} variant="outline">
                          {tag.namespace}:{tag.name}
                        </Badge>
                      ))}
                      {preview.tags.length > 30 && <Badge variant="outline">+{preview.tags.length - 30}</Badge>}
                    </div>
                    {preview.warnings.length > 0 && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                        {preview.warnings.map((warning) => (
                          <div key={warning}>{warning}</div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() =>
                          enqueueMutation.mutate({ previewToken: preview.previewToken, quality: 'ORIGINAL' })
                        }
                        disabled={enqueueMutation.isPending}
                      >
                        {enqueueMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                        {preview.activeTaskId ? '打开现有任务' : preview.isUpdate ? '确认归档新版本' : '确认原图归档'}
                      </Button>
                      <Button variant="outline" onClick={() => setPreview(null)}>
                        取消预览
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-lg">归档任务</CardTitle>
              <CardDescription>
                部分失败且已有成功图片的暂存保留 30 天；零进度失败和取消任务保留 7 天；暂停任务会一直保留。
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => tasksQuery.refetch()} disabled={tasksQuery.isFetching}>
              <RefreshCw className={tasksQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              刷新
            </Button>
          </CardHeader>
          <CardContent>
            {tasksQuery.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : tasksQuery.data?.length ? (
              <div className="divide-y rounded-lg border">
                {tasksQuery.data.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    acting={actionMutation.isPending}
                    onAction={(action) => actionMutation.mutate({ taskId: task.id, action })}
                    onViewItems={() => setDetailTaskId(task.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-sm text-muted-foreground">还没有链接归档任务。</div>
            )}
          </CardContent>
        </Card>
      </div>
      <ArchiveItemDrawer
        key={`${detailTask?.id ?? 'archive-item-drawer'}:${detailRefreshVersion}`}
        open={Boolean(detailTaskId && detailTask)}
        task={detailTask}
        onOpenChange={(open) => {
          if (!open) setDetailTaskId(null)
        }}
        onTaskChanged={() => tasksQuery.refetch()}
      />
    </div>
  )
}

function TaskRow({
  task,
  acting,
  onAction,
  onViewItems
}: {
  task: ArchiveTaskOutput
  acting: boolean
  onViewItems: () => void
  onAction: (
    action:
      | 'PAUSE'
      | 'RESUME'
      | 'CANCEL'
      | 'RETRY'
      | 'USE_DISPLAY_QUALITY'
      | 'DELETE_STAGING'
      | 'DELETE_ARCHIVE'
      | 'RESTORE_ARCHIVE'
  ) => void
}) {
  const active = ACTIVE_STATUSES.has(task.status)
  const deleted = Boolean(task.publishedArtwork?.deletedAt)
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{task.title || `E-Hentai #${task.externalId}`}</span>
            <StatusBadge status={task.status} errorCode={task.errorCode} />
            <Badge variant="outline">{task.selectedQuality === 'ORIGINAL' ? '原图' : '展示质量'}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {task.providerKey} #{task.externalId} · 成功 {task.completedItems} · 失败 {task.failedItems} · 共{' '}
            {task.totalItems} 张 · 尝试 {task.attempt}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onViewItems}>
            <Images /> 图片明细
          </Button>
          {task.status === 'RUNNING' && (
            <Button variant="outline" size="sm" disabled={acting} onClick={() => onAction('PAUSE')}>
              <CirclePause /> 暂停
            </Button>
          )}
          {task.status === 'PAUSED' && task.decisionCode !== 'USE_DISPLAY_QUALITY' && (
            <Button variant="outline" size="sm" disabled={acting} onClick={() => onAction('RESUME')}>
              <CirclePlay /> 继续
            </Button>
          )}
          {task.decisionCode === 'USE_DISPLAY_QUALITY' && (
            <Button size="sm" disabled={acting} onClick={() => onAction('USE_DISPLAY_QUALITY')}>
              <CirclePlay /> 改用展示质量继续
            </Button>
          )}
          {['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'].includes(task.status) && (
            <Button
              variant="destructive"
              size="sm"
              disabled={acting || task.status === 'CANCELLING'}
              onClick={() => onAction('CANCEL')}
            >
              <Square /> {task.status === 'CANCELLING' ? '正在取消' : '取消'}
            </Button>
          )}
          {['FAILED', 'CANCELLED'].includes(task.status) && (
            <Button variant="outline" size="sm" disabled={acting} onClick={() => onAction('RETRY')}>
              <RotateCcw /> 重试
            </Button>
          )}
          {task.status === 'COMPLETED' && task.publishedArtwork && !deleted && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/artworks/${task.publishedArtwork.id}`}>
                  <ExternalLink /> 查看作品
                </Link>
              </Button>
              <Button variant="destructive" size="sm" disabled={acting} onClick={() => onAction('DELETE_ARCHIVE')}>
                <Trash2 /> 移入回收站
              </Button>
            </>
          )}
          {task.status === 'COMPLETED' && deleted && (
            <Button variant="outline" size="sm" disabled={acting} onClick={() => onAction('RESTORE_ARCHIVE')}>
              <RotateCcw /> 从回收站恢复
            </Button>
          )}
          {!active && task.status !== 'COMPLETED' && (
            <Button variant="ghost" size="sm" disabled={acting} onClick={() => onAction('DELETE_STAGING')}>
              <Trash2 /> 清理暂存
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{task.message || task.status}</span>
          <span>{task.progress}%</span>
        </div>
        <Progress value={task.progress} />
      </div>
      {task.warning && <p className="whitespace-pre-wrap text-xs text-amber-700">{task.warning}</p>}
      {task.errorMessage && <p className="whitespace-pre-wrap text-sm text-destructive">{task.errorMessage}</p>}
      {task.retainUntil && task.status !== 'COMPLETED' && (
        <p className="text-xs text-muted-foreground">暂存预计保留至 {formatRetentionTime(task.retainUntil)}</p>
      )}
    </div>
  )
}

function StatusBadge({ status, errorCode }: { status: string; errorCode: string | null }) {
  const variant = status === 'COMPLETED' ? 'default' : status === 'FAILED' ? 'destructive' : 'secondary'
  const labels: Record<string, string> = {
    PENDING: '排队中',
    RUNNING: '下载中',
    PAUSED: '已暂停',
    CANCELLING: '正在取消',
    COMPLETED: '已发布',
    FAILED: '失败',
    CANCELLED: '已取消'
  }
  const label = status === 'FAILED' && errorCode === 'PARTIAL_FAILURE' ? '部分失败' : labels[status] || status
  return <Badge variant={variant}>{label}</Badge>
}

function formatRetentionTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}
