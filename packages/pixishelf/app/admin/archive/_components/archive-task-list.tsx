'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { inferRouterOutputs } from '@trpc/server'
import type { ArchiveTransferTelemetry } from '@pixishelf/job-contracts'
import {
  CirclePause,
  CirclePlay,
  ExternalLink,
  Images,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Users
} from 'lucide-react'
import type { AppRouter } from '@/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { SourcePreviewButton } from '@/components/source-preview/source-preview-button'
import { AdminStatusBadge } from '../../_components/admin-status-badge'
import { ArchiveTaskCreators } from './archive-task-creators'
import { ArchiveTaskCreatorDialog } from './archive-task-creator-dialog'
import { TaskProgress } from './archive-task-progress'
import { archiveTaskArtworkHref, archiveTaskSourceHref } from './archive-task-navigation'
import { archiveSourceLabel } from './archive-source-label'
import {
  archiveMaintenanceRetryAction,
  archiveTaskDisplayStatus,
  archiveTaskStatusLabel,
  type ArchiveTaskBulkAction
} from './archive-task-view-state'

export type ArchiveTaskOutput = inferRouterOutputs<AppRouter>['archive']['listTasks']['items'][number]
export type ArchiveTaskView = ArchiveTaskOutput & { liveTransfer?: ArchiveTransferTelemetry | null }
export type SingleTaskAction =
  | ArchiveTaskBulkAction
  | 'USE_DISPLAY_QUALITY'
  | 'DELETE_STAGING'
  | 'DELETE_ARCHIVE'
  | 'RESTORE_ARCHIVE'
const ACTIVE_STATUSES = new Set(['PENDING', 'RUNNING', 'RETRY_WAIT', 'CANCELLING'])

export function ArchiveTaskTable({
  tasks,
  selectedTaskIds,
  selectionState,
  pendingActions,
  onToggleAll,
  onToggleTask,
  onViewItems,
  onAction
}: {
  tasks: ArchiveTaskView[]
  selectedTaskIds: ReadonlySet<string>
  selectionState: boolean | 'indeterminate'
  pendingActions: ReadonlySet<string>
  onToggleAll: (checked: boolean) => void
  onToggleTask: (taskId: string, checked: boolean) => void
  onViewItems: (task: ArchiveTaskOutput) => void
  onAction: (task: ArchiveTaskOutput, action: SingleTaskAction) => void
}) {
  return (
    <Table className="table-fixed [&_td]:py-2.5">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={selectionState}
              onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
              aria-label="选择当前页全部任务"
            />
          </TableHead>
          <TableHead>作品 / 来源</TableHead>
          <TableHead className="w-44">状态</TableHead>
          <TableHead className="w-20">图片</TableHead>
          <TableHead className="w-28">创建时间</TableHead>
          <TableHead className="w-32 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TableRow key={task.id} data-state={selectedTaskIds.has(task.id) ? 'selected' : undefined}>
            <TableCell>
              <Checkbox
                checked={selectedTaskIds.has(task.id)}
                onCheckedChange={(checked) => onToggleTask(task.id, Boolean(checked))}
                aria-label={`选择 ${task.title || archiveSourceLabel(task.providerKey, task.externalId)}`}
              />
            </TableCell>
            <TableCell className="min-w-0 whitespace-normal">
              <TaskIdentity task={task} onViewItems={() => onViewItems(task)} />
            </TableCell>
            <TableCell className="whitespace-normal">
              <div className="flex min-w-0 flex-col gap-1">
                <TaskStatus task={task} />
                <TaskProgress task={task} />
              </div>
            </TableCell>
            <TableCell className="text-xs tabular-nums">{task.totalItems} 张</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatTaskTime(task.createdAt)}</TableCell>
            <TableCell>
              <TaskActions
                task={task}
                pendingActions={pendingActions}
                onViewItems={() => onViewItems(task)}
                onAction={(action) => onAction(task, action)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function ArchiveTaskCard({
  task,
  selected,
  pendingActions,
  onToggle,
  onViewItems,
  onAction
}: {
  task: ArchiveTaskView
  selected: boolean
  pendingActions: ReadonlySet<string>
  onToggle: (checked: boolean) => void
  onViewItems: () => void
  onAction: (action: SingleTaskAction) => void
}) {
  return (
    <Card
      data-state={selected ? 'selected' : undefined}
      className="min-w-0 gap-2 py-3 data-[state=selected]:ring-2 data-[state=selected]:ring-ring"
    >
      <CardHeader className="min-w-0 px-3">
        <div className="flex min-w-0 items-start gap-2">
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onToggle(Boolean(checked))}
            aria-label={`选择 ${task.title || archiveSourceLabel(task.providerKey, task.externalId)}`}
          />
          <div className="min-w-0 flex-1">
            <TaskIdentity task={task} onViewItems={onViewItems} />
          </div>
          <TaskActions task={task} pendingActions={pendingActions} onViewItems={onViewItems} onAction={onAction} />
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2 px-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TaskStatus task={task} />
          <span className="text-xs tabular-nums text-muted-foreground">
            {task.totalItems} 张 · {formatTaskTime(task.createdAt)}
          </span>
        </div>
        <TaskProgress task={task} />
      </CardContent>
    </Card>
  )
}

function TaskIdentity({ task, onViewItems }: { task: ArchiveTaskOutput; onViewItems: () => void }) {
  const artworkHref = archiveTaskArtworkHref(task)
  const title = (
    <PrivacySensitiveText className="line-clamp-2 break-words [overflow-wrap:anywhere] md:line-clamp-1">
      {task.title || archiveSourceLabel(task.providerKey, task.externalId)}
    </PrivacySensitiveText>
  )
  const titleClass =
    'block min-w-0 w-full rounded-sm text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {artworkHref ? (
        <Link href={artworkHref} className={titleClass}>
          {title}
        </Link>
      ) : (
        <button type="button" className={titleClass} onClick={onViewItems}>
          {title}
        </button>
      )}
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <PrivacySensitiveText className="max-w-[45%] shrink-0 truncate">
          {archiveSourceLabel(task.providerKey, task.externalId)}
        </PrivacySensitiveText>
        <span aria-hidden="true">·</span>
        <ArchiveTaskCreators task={task} compact />
      </div>
    </div>
  )
}

function TaskStatus({ task }: { task: ArchiveTaskOutput }) {
  const lifecycleState = task.publishedArtwork?.archiveLifecycleState
  const displayStatus = archiveTaskDisplayStatus(task)
  return (
    <div className="flex flex-col items-start gap-1">
      <AdminStatusBadge status={displayStatus}>
        {archiveTaskStatusLabel(displayStatus, task.errorCode)}
      </AdminStatusBadge>
      {task.decisionCode === 'USE_DISPLAY_QUALITY' && (
        <span className="text-xs text-warning">可按原质量继续，或在操作中改用展示质量</span>
      )}
      {lifecycleState === 'TRASHING' && <span className="text-xs text-warning">正在移入回收站</span>}
      {lifecycleState === 'RESTORING' && <span className="text-xs text-warning">正在从回收站恢复</span>}
      {lifecycleState === 'TRASHED' && <span className="text-xs text-muted-foreground">作品已在回收站</span>}
    </div>
  )
}

function TaskActions({
  task,
  pendingActions,
  onViewItems,
  onAction
}: {
  task: ArchiveTaskOutput
  pendingActions: ReadonlySet<string>
  onViewItems: () => void
  onAction: (action: SingleTaskAction) => void
}) {
  const [creatorsOpen, setCreatorsOpen] = useState(false)
  const isPending = (action: SingleTaskAction) => pendingActions.has(singleActionKey(task.id, action))
  const lifecycleState = task.publishedArtwork?.archiveLifecycleState
  const deleted = lifecycleState === 'TRASHED'
  const lifecyclePending = lifecycleState === 'TRASHING' || lifecycleState === 'RESTORING'
  const maintenanceRetryAction = archiveMaintenanceRetryAction(lifecycleState)
  const displayStatus = archiveTaskDisplayStatus(task)
  const active = ACTIVE_STATUSES.has(displayStatus)
  return (
    <div className="flex shrink-0 justify-end gap-1">
      <SourcePreviewButton source={{ kind: 'task', taskId: task.id }} variant="ghost" size="sm" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="打开任务操作菜单">
            <MoreHorizontal data-icon="inline-start" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onViewItems}>
              <Images aria-hidden="true" />
              任务详情
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCreatorsOpen(true)}>
              <Users aria-hidden="true" />
              管理艺术家
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a
                href={archiveTaskSourceHref(task.id)}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                <ExternalLink aria-hidden="true" />
                打开原站
              </a>
            </DropdownMenuItem>
            {['RUNNING', 'RETRY_WAIT'].includes(displayStatus) && (
              <DropdownMenuItem disabled={isPending('PAUSE')} onSelect={() => onAction('PAUSE')}>
                {isPending('PAUSE') ? <Spinner /> : <CirclePause aria-hidden="true" />}暂停任务
              </DropdownMenuItem>
            )}
            {displayStatus === 'PAUSED' && (
              <DropdownMenuItem disabled={isPending('RESUME')} onSelect={() => onAction('RESUME')}>
                {isPending('RESUME') ? <Spinner /> : <CirclePlay aria-hidden="true" />}继续任务
              </DropdownMenuItem>
            )}
            {task.decisionCode === 'USE_DISPLAY_QUALITY' && (
              <DropdownMenuItem
                disabled={isPending('USE_DISPLAY_QUALITY')}
                onSelect={() => onAction('USE_DISPLAY_QUALITY')}
              >
                {isPending('USE_DISPLAY_QUALITY') ? <Spinner /> : <CirclePlay aria-hidden="true" />}改用展示质量继续
              </DropdownMenuItem>
            )}
            {['FAILED', 'CANCELLED'].includes(task.status) && (
              <DropdownMenuItem disabled={isPending('RETRY')} onSelect={() => onAction('RETRY')}>
                {isPending('RETRY') ? <Spinner /> : <RotateCcw aria-hidden="true" />}重试任务
              </DropdownMenuItem>
            )}
            {archiveTaskArtworkHref(task) && (
              <DropdownMenuItem asChild>
                <Link href={archiveTaskArtworkHref(task)!}>
                  <ExternalLink aria-hidden="true" />
                  查看作品
                </Link>
              </DropdownMenuItem>
            )}
            {task.status === 'COMPLETED' && deleted && (
              <DropdownMenuItem disabled={isPending('RESTORE_ARCHIVE')} onSelect={() => onAction('RESTORE_ARCHIVE')}>
                {isPending('RESTORE_ARCHIVE') ? <Spinner /> : <RotateCcw aria-hidden="true" />}从回收站恢复
              </DropdownMenuItem>
            )}
            {task.status === 'COMPLETED' && maintenanceRetryAction && (
              <DropdownMenuItem
                disabled={isPending(maintenanceRetryAction)}
                onSelect={() => onAction(maintenanceRetryAction)}
              >
                {isPending(maintenanceRetryAction) ? <Spinner /> : <RefreshCw aria-hidden="true" />}
                {lifecycleState === 'TRASHING' ? '继续移入回收站' : '继续恢复归档'}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {(['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'].includes(task.status) ||
            (task.status === 'COMPLETED' && task.publishedArtwork && !deleted && !lifecyclePending) ||
            (!active && task.status !== 'COMPLETED')) && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            {['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'].includes(task.status) && (
              <DropdownMenuItem
                variant="destructive"
                disabled={task.status === 'CANCELLING' || isPending('CANCEL')}
                onSelect={() => onAction('CANCEL')}
              >
                {isPending('CANCEL') ? <Spinner /> : <Square aria-hidden="true" />}
                {task.status === 'CANCELLING' ? '正在取消' : '取消任务'}
              </DropdownMenuItem>
            )}
            {task.status === 'COMPLETED' && task.publishedArtwork && !deleted && !lifecyclePending && (
              <DropdownMenuItem
                variant="destructive"
                disabled={isPending('DELETE_ARCHIVE')}
                onSelect={() => onAction('DELETE_ARCHIVE')}
              >
                {isPending('DELETE_ARCHIVE') ? <Spinner /> : <Trash2 aria-hidden="true" />}移入回收站
              </DropdownMenuItem>
            )}
            {!active && task.status !== 'COMPLETED' && (
              <DropdownMenuItem
                variant="destructive"
                disabled={isPending('DELETE_STAGING')}
                onSelect={() => onAction('DELETE_STAGING')}
              >
                {isPending('DELETE_STAGING') ? <Spinner /> : <Trash2 aria-hidden="true" />}清理暂存文件
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {creatorsOpen && <ArchiveTaskCreatorDialog taskId={task.id} onClose={() => setCreatorsOpen(false)} />}
    </div>
  )
}

function singleActionKey(taskId: string, action: SingleTaskAction): string {
  return `${taskId}:${action}`
}

function formatTaskTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
}
