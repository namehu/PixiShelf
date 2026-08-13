'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Activity, CheckCircle2, ChevronDown, Clock, Loader2, XCircle, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export interface ScheduledTaskView {
  key: string
  type: string
  name: string
  description: string
  enabled: boolean
  scheduleMode: string
  time: string
  timezone: string
  priority: number
  mutexKey: string | null
  lastTriggeredAt: string | Date | null
  lastTriggeredDate: string | null
  lastJobId: string | null
  lastJobStatus: string | null
  nextRunAt: string | null
}

export interface JobView {
  status: string
  progress: number
  message?: string | null
  error?: string | null
  result?: unknown
}

export interface TaskDraft {
  enabled: boolean
  time: string
  priority: string
}

export function getDraftForTask(task: ScheduledTaskView, drafts: Record<string, TaskDraft>) {
  return (
    drafts[task.key] ?? {
      enabled: task.enabled,
      time: task.time,
      priority: String(task.priority)
    }
  )
}

const TaskAccordionContext = createContext<{
  expandedId: string | null
  toggle: (id: string) => void
} | null>(null)

export function TaskAccordion({ defaultValue, children }: { defaultValue: string; children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const value = searchParams.get('task')
  const expandedId = value === 'none' ? null : value || defaultValue

  const toggle = (id: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('task', expandedId === id ? 'none' : id)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <TaskAccordionContext.Provider value={{ expandedId, toggle }}>
      <div className="space-y-7">{children}</div>
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
    <section aria-labelledby={`task-group-${title}`} className="space-y-3">
      <div className="px-1">
        <h2 id={`task-group-${title}`} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
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
        'relative scroll-mt-24 overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow]',
        expanded && 'border-blue-200 shadow-md shadow-blue-950/5'
      )}
    >
      <span
        className={cn(
          'absolute inset-y-0 left-0 w-1 bg-border',
          tone === 'active' && 'bg-blue-500',
          tone === 'success' && 'bg-emerald-500',
          tone === 'error' && 'bg-red-500'
        )}
        aria-hidden="true"
      />
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => accordion.toggle(id)}
        className="flex w-full items-start gap-3 py-4 pr-4 pl-5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:items-center sm:px-5 sm:py-4 sm:pl-6"
      >
        <div
          className={cn(
            'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground sm:mt-0',
            expanded && 'bg-blue-50 text-blue-600'
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
            <span className="text-xs text-muted-foreground">{category}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-pretty text-sm leading-5 text-muted-foreground sm:line-clamp-1">
            {description}
          </p>
          <div className="mt-2 text-xs leading-5 text-muted-foreground sm:hidden">{summary}</div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3 self-center">
          <div className="hidden text-right text-xs text-muted-foreground sm:block">{summary}</div>
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
              expanded && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </div>
      </button>
      {expanded ? (
        <div id={panelId} className="border-t bg-muted/10 px-5 py-5 sm:px-6">
          {action ? <div className="mb-4 flex flex-wrap justify-end gap-2">{action}</div> : null}
          {children ? <div className="flex flex-col gap-4">{children}</div> : null}
        </div>
      ) : null}
    </article>
  )
}

export function JobStatus({
  job,
  isRunning,
  completeContent
}: {
  job: JobView | null | undefined
  isRunning: boolean
  completeContent?: ReactNode
}) {
  if (!isJobVisible(job, isRunning)) return null

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card" aria-live="polite">
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            {isRunning ? (
              <Loader2 className="size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
            ) : job?.status === 'COMPLETED' ? (
              <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
            ) : job?.status === 'FAILED' ? (
              <XCircle className="size-4 text-destructive" aria-hidden="true" />
            ) : (
              <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
            )}
            <span>{formatJobStatus(job?.status)}</span>
            {job?.message && (
              <span className="hidden font-normal text-muted-foreground sm:inline">· {job.message}</span>
            )}
          </div>
          <span className="font-medium tabular-nums text-muted-foreground">{job?.progress ?? 0}%</span>
        </div>
        {job?.message && <p className="text-sm text-muted-foreground sm:hidden">{job.message}</p>}
        <Progress value={job?.progress ?? 0} className="h-2" aria-label={`任务进度 ${job?.progress ?? 0}%`} />
        {job?.error && <p className="mt-2 break-words text-sm font-medium text-destructive">错误：{job.error}</p>}
      </div>
      {job?.status === 'COMPLETED' && completeContent && (
        <div className="border-t bg-muted/20 px-4 py-3 text-sm">{completeContent}</div>
      )}
      {job?.status === 'COMPLETED' && !completeContent && (
        <div className="border-t bg-muted/20 px-4 py-3 text-sm font-medium text-emerald-600">任务完成</div>
      )}
      {job?.status === 'CANCELLED' && (
        <div className="border-t bg-muted/20 px-4 py-3 text-sm text-muted-foreground">任务已取消</div>
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
  const priority = Number(draft.priority)
  const priorityInvalid = draft.priority.trim() === '' || Number.isNaN(priority)
  const changed = draft.enabled !== task.enabled || draft.time !== task.time || priority !== task.priority
  const enabledId = `schedule-${task.key}-enabled`
  const timeId = `schedule-${task.key}-time`
  const priorityId = `schedule-${task.key}-priority`

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/25 px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium">定时计划</h3>
        </div>
        <Badge variant={task.enabled ? 'secondary' : 'outline'}>{task.enabled ? '已启用' : '已停用'}</Badge>
      </div>
      <div className="space-y-5 p-4">
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3 lg:grid-cols-4">
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">执行模式</dt>
            <dd className="font-medium text-foreground">
              {task.scheduleMode === 'DAILY' ? '每日' : task.scheduleMode}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">时区</dt>
            <dd className="font-medium text-foreground">{task.timezone}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">下次计划执行</dt>
            <dd className="font-medium text-foreground">{task.nextRunAt || '—'}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">上次触发时间</dt>
            <dd className="font-medium text-foreground">{formatDateTime(task.lastTriggeredAt)}</dd>
          </div>
          {task.mutexKey && (
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">互斥组</dt>
              <dd className="break-words font-medium text-foreground">{task.mutexKey}</dd>
            </div>
          )}
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">上次自动日期</dt>
            <dd className="font-medium text-foreground">{task.lastTriggeredDate || '—'}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">最近任务状态</dt>
            <dd className="font-medium text-foreground">{formatJobStatus(task.lastJobStatus || undefined)}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-4 border-t border-dashed pt-4 sm:flex-row sm:items-end">
          <div className="flex min-h-9 shrink-0 items-center gap-2 rounded-md border bg-muted/25 px-3">
            <Switch
              id={enabledId}
              checked={draft.enabled}
              onCheckedChange={(checked) => onDraftChange({ enabled: checked })}
            />
            <label htmlFor={enabledId} className="min-w-12 cursor-pointer text-sm font-medium">
              {draft.enabled ? '已启用' : '已停用'}
            </label>
          </div>
          <div className="flex flex-1 flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label htmlFor={timeId} className="block text-xs font-medium text-muted-foreground">
                执行时间
              </label>
              <Input
                id={timeId}
                name={`${task.key}-time`}
                type="time"
                autoComplete="off"
                value={draft.time}
                onChange={(event) => onDraftChange({ time: event.target.value })}
                className="h-9 w-[120px]"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={priorityId} className="block text-xs font-medium text-muted-foreground">
                优先级
              </label>
              <Input
                id={priorityId}
                name={`${task.key}-priority`}
                type="number"
                inputMode="numeric"
                autoComplete="off"
                min={0}
                max={1000}
                value={draft.priority}
                onChange={(event) => onDraftChange({ priority: event.target.value })}
                className="h-9 w-[90px]"
                title="优先级，数字越小越先执行"
              />
            </div>
          </div>
          <Button
            variant={changed ? 'default' : 'outline'}
            size="sm"
            onClick={onSave}
            disabled={isSaving || !changed || priorityInvalid}
            className="h-9 shrink-0"
          >
            {isSaving && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {isSaving ? '保存中…' : '保存计划'}
          </Button>
        </div>
      </div>
    </div>
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
    <a
      href={href}
      className="inline-flex min-h-8 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </a>
  )
}

function isJobVisible(job: JobView | null | undefined, isRunning: boolean) {
  return Boolean(job && (isRunning || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)))
}

function formatJobStatus(status: string | undefined) {
  if (status === 'PENDING') return '等待执行'
  if (status === 'RUNNING') return '正在执行'
  if (status === 'CANCELLING') return '正在取消'
  if (status === 'COMPLETED') return '已完成'
  if (status === 'FAILED') return '执行失败'
  if (status === 'CANCELLED') return '已取消'
  return status || '状态未知'
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
