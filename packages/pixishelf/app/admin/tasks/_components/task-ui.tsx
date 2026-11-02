'use client'

import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { JobProgressData, JobStatus } from '@pixishelf/job-contracts'
import { Activity, ChevronDown, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createContext, type ReactNode, useContext } from 'react'
import { AdminStatusBadge } from '../../_components/admin-status-badge'
import { ACTIVE_TASK_STATUSES, EXECUTING_TASK_STATUSES, formatTaskStatus, TERMINAL_TASK_STATUSES } from './task-status'

export interface ScheduledTaskView {
  key: string
  type: string
  name: string
  description: string
  enabled: boolean
  scheduleMode: string
  timezone: string
  priority: number
  lastMaterializedAt: string | Date | null
  lastMaterializedDate: string | null
  lastJobId: string | null
  lastJobStatus: JobStatus | null
  lastJobMode?: 'FORMAL' | 'PREVIEW' | null
  lastJobResult?: {
    deletedBulkOperations?: number
    deletedIntakeItems?: number
    deletedSubmissions?: number
    deletedPreviewSessions?: number
    deletedLogs?: number
    deletedRuns?: number
    progressCandidates?: number
    lifecycleCandidates?: number
    deletedProgressEvents?: number
    deletedLifecycleEvents?: number
    selected?: number
    deleted?: number
    missing?: number
    referenced?: number
    failed?: number
    reconciliationScanned?: number
    untrackedCandidates?: number
  } | null
  nextRunAt: string | null
  config?: unknown
  executionWindow?: {
    timezone: 'Asia/Shanghai'
    startAt: string
    endAt: string
  }
}

export interface JobView {
  id?: string
  type?: string
  status: JobStatus
  progress: number
  stage?: string | null
  progressData?: JobProgressData | null
  message?: string | null
  error?: string | null
  result?: unknown
  heartbeatAt?: string | null
  updatedAt?: string
}

export function getJobSummary(job: JobView | null | undefined, isRunning: boolean) {
  if (isRunning) return `${formatTaskStatus(job?.status)} · ${job?.progress ?? 0}%`
  if (job?.status === 'FAILED') return '需要处理 · 上次执行失败'
  return null
}

export function getStandaloneSummary(task: ScheduledTaskView) {
  if (task.lastJobStatus && ACTIVE_TASK_STATUSES.includes(task.lastJobStatus)) {
    return formatTaskStatus(task.lastJobStatus)
  }
  if (task.lastJobStatus === 'FAILED') return '需要处理 · 上次执行失败'
  return null
}

export interface TaskDraft {
  priority: string
}

export const SCHEDULED_TASK_PRIORITY_MINIMUM = 0
export const SCHEDULED_TASK_PRIORITY_MAXIMUM = 999

export function isScheduledTaskPriorityValid(value: string) {
  const priority = Number(value)
  return (
    value.trim() !== '' &&
    Number.isInteger(priority) &&
    priority >= SCHEDULED_TASK_PRIORITY_MINIMUM &&
    priority <= SCHEDULED_TASK_PRIORITY_MAXIMUM
  )
}

export function getDraftForTask(task: ScheduledTaskView, drafts: Record<string, TaskDraft>) {
  return (
    drafts[task.key] ?? {
      priority: String(task.priority)
    }
  )
}

export function getScheduledTaskUpdate(task: ScheduledTaskView, draft: TaskDraft) {
  return {
    key: task.key,
    priority: Number(draft.priority)
  }
}

const TaskAccordionContext = createContext<{
  expandedId: string | null
  toggle: (id: string) => void
} | null>(null)

export function TaskAccordion({ defaultValue, children }: { defaultValue?: string; children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const value = searchParams.get('task')
  const expandedId = value === 'none' ? null : value || defaultValue || null

  const toggle = (id: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (expandedId === id) params.delete('task')
    else params.set('task', id)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <TaskAccordionContext.Provider value={{ expandedId, toggle }}>
      <div className="flex flex-col gap-8">{children}</div>
    </TaskAccordionContext.Provider>
  )
}

export function TaskGroup({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`task-group-${title}`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 id={`task-group-${title}`} className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

export function TaskSection({
  id,
  category,
  icon: Icon,
  title,
  description,
  summary,
  tone = 'idle',
  action,
  schedule,
  settings,
  children
}: {
  id: string
  category: string
  icon: LucideIcon
  title: string
  description: string
  summary: ReactNode
  tone?: 'idle' | 'active' | 'success' | 'error'
  action?: ReactNode
  schedule?: ReactNode
  settings?: ReactNode
  children?: ReactNode
}) {
  const accordion = useContext(TaskAccordionContext)
  if (!accordion) throw new Error('TaskSection must be rendered inside TaskAccordion')

  const expanded = accordion.expandedId === id
  const panelId = `${id}-panel`

  return (
    <article
      id={id}
      className={cn(
        'relative scroll-mt-24 overflow-hidden rounded-lg border bg-card transition-[border-color,box-shadow]',
        expanded && 'border-primary/35 shadow-surface',
        tone === 'active' && 'border-primary/35',
        tone === 'error' && 'border-destructive/35'
      )}
    >
      <span
        className={cn(
          'absolute inset-y-0 left-0 w-0.5 bg-border',
          tone === 'active' && 'bg-primary',
          tone === 'success' && 'bg-success',
          tone === 'error' && 'bg-destructive'
        )}
        aria-hidden="true"
      />
      <div className="flex flex-col sm:flex-row sm:items-center">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => accordion.toggle(id)}
          className="flex w-full min-w-0 flex-1 items-start gap-3 py-3.5 pr-4 pl-5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:items-center sm:px-5 sm:pl-6"
        >
          <div
            className={cn(
              'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground sm:mt-0',
              expanded && 'bg-accent text-primary'
            )}
          >
            <Icon className="size-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                role="heading"
                aria-level={3}
                className="text-sm font-semibold tracking-tight text-foreground sm:text-base"
              >
                {title}
              </span>
              <span className="rounded-md border px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
                {category}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-pretty text-sm leading-5 text-muted-foreground sm:line-clamp-1">
              {description}
            </p>
            {summary ? <div className="mt-2 text-xs leading-5 text-muted-foreground sm:hidden">{summary}</div> : null}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3 self-center">
            {summary ? (
              <div
                className={cn(
                  'hidden text-right text-xs text-muted-foreground sm:block',
                  tone === 'active' && 'font-medium text-primary',
                  tone === 'error' && 'font-medium text-destructive'
                )}
              >
                {summary}
              </div>
            ) : null}
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
                expanded && 'rotate-180'
              )}
              aria-hidden="true"
            />
          </div>
        </button>
        {schedule ? <div className="shrink-0 pr-4 pb-2 pl-17 sm:pr-5 sm:pb-0 sm:pl-0">{schedule}</div> : null}
      </div>
      {expanded ? (
        <div id={panelId} className="border-t bg-muted/10 px-4 py-4 sm:px-6 sm:py-5">
          {settings ? <div className="mb-4">{settings}</div> : null}
          {action ? <div className="mb-4 flex flex-wrap justify-start gap-2 sm:justify-end">{action}</div> : null}
          {children ? <div className="flex flex-col gap-4">{children}</div> : null}
        </div>
      ) : null}
    </article>
  )
}

export function JobStatus({
  job,
  isRunning,
  progressContent,
  completeContent
}: {
  job: JobView | null | undefined
  isRunning: boolean
  progressContent?: ReactNode
  completeContent?: ReactNode
}) {
  if (!isJobVisible(job, isRunning)) return null

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card" aria-live="polite">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            {job && EXECUTING_TASK_STATUSES.includes(job.status) ? (
              <Spinner className="text-primary" aria-hidden="true" />
            ) : (
              <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
            )}
            <AdminStatusBadge status={job?.status || 'IDLE'}>{formatTaskStatus(job?.status)}</AdminStatusBadge>
            {job?.message && (
              <span className="hidden font-normal text-muted-foreground sm:inline">
                · <PrivacySensitiveText>{job.message}</PrivacySensitiveText>
              </span>
            )}
          </div>
          <span className="font-medium tabular-nums text-muted-foreground">{job?.progress ?? 0}%</span>
        </div>
        {job?.message && (
          <PrivacySensitiveText as="p" className="text-sm text-muted-foreground sm:hidden">
            {job.message}
          </PrivacySensitiveText>
        )}
        <Progress value={job?.progress ?? 0} className="h-2" aria-label={`任务进度 ${job?.progress ?? 0}%`} />
        {progressContent ? <div className="border-t pt-3">{progressContent}</div> : null}
        {job?.error && (
          <p className="mt-2 break-words text-sm font-medium text-destructive">
            错误：<PrivacySensitiveText>{job.error}</PrivacySensitiveText>
          </p>
        )}
      </div>
      {job?.status === 'COMPLETED' && completeContent && (
        <div className="border-t bg-muted/20 px-4 py-3 text-sm">{completeContent}</div>
      )}
      {job?.status === 'COMPLETED' && !completeContent && (
        <div className="border-t bg-muted/20 px-4 py-3 text-sm font-medium text-success">任务完成</div>
      )}
      {job?.status === 'CANCELLED' && (
        <div className="border-t bg-muted/20 px-4 py-3 text-sm text-muted-foreground">任务已取消</div>
      )}
      {job?.status === 'SKIPPED' && (
        <div className="border-t bg-muted/20 px-4 py-3 text-sm text-muted-foreground">任务已跳过</div>
      )}
    </div>
  )
}

export function ScheduleSettings({
  task,
  draft,
  onDraftChange,
  onSave,
  isSaving
}: {
  task: ScheduledTaskView
  draft: TaskDraft
  onDraftChange: (patch: Partial<TaskDraft>) => void
  onSave: () => void
  isSaving: boolean
}) {
  const priorityInvalid = !isScheduledTaskPriorityValid(draft.priority)
  const changed = Number(draft.priority) !== task.priority
  const priorityId = `schedule-${task.key}-priority`
  return (
    <FieldGroup className="flex-row flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      <Field className="w-28 gap-1.5" data-invalid={priorityInvalid}>
        <FieldLabel htmlFor={priorityId} className="text-xs text-muted-foreground">
          优先级
        </FieldLabel>
        <Input
          id={priorityId}
          name={`${task.key}-priority`}
          type="number"
          inputMode="numeric"
          autoComplete="off"
          min={SCHEDULED_TASK_PRIORITY_MINIMUM}
          max={SCHEDULED_TASK_PRIORITY_MAXIMUM}
          value={draft.priority}
          onChange={(event) => onDraftChange({ priority: event.target.value })}
          className="min-h-11"
          aria-invalid={priorityInvalid}
          aria-describedby={`${priorityId}-help${priorityInvalid ? ` ${priorityId}-error` : ''}`}
        />
        {priorityInvalid && <FieldError id={`${priorityId}-error`}>请输入 0–999 的整数。</FieldError>}
      </Field>
      <Button
        variant={changed ? 'default' : 'outline'}
        onClick={onSave}
        disabled={isSaving || !changed || priorityInvalid}
        className="min-h-11"
      >
        {isSaving && <Spinner data-icon="inline-start" aria-hidden="true" />}
        {isSaving ? '保存中…' : '保存优先级'}
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
        <p id={`${priorityId}-help`}>数字越小越先执行（0–999）</p>
        <p>上次自动入队：{formatDateTime(task.lastMaterializedAt)}</p>
      </div>
    </FieldGroup>
  )
}

export function OverviewStat({
  label,
  value,
  loading = false,
  active = false
}: {
  label: string
  value: number
  loading?: boolean
  active?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          active ? 'mt-1 text-xl font-semibold tabular-nums text-primary' : 'mt-1 text-xl font-semibold tabular-nums'
        }
      >
        {loading ? '—' : new Intl.NumberFormat('zh-CN').format(value)}
      </dd>
    </div>
  )
}

export function TaskNavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-8 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  )
}

function isJobVisible(job: JobView | null | undefined, isRunning: boolean) {
  return Boolean(job && (isRunning || TERMINAL_TASK_STATUSES.includes(job.status)))
}

function formatDateTime(value: string | Date | null) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)
}
