import type { ArtworkDedupControlAction, ArtworkDedupRunDto } from '@pixishelf/job-contracts'
import { MoreHorizontal, Pause, Play, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { AdminStatusBadge } from '../../_components/admin-status-badge'

export function isDuplicateRunActive(run: ArtworkDedupRunDto) {
  return ['PENDING', 'RETRY_WAIT', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING'].includes(run.status)
}

const statusLabels = {
  PENDING: '排队中',
  RETRY_WAIT: '等待重试',
  RUNNING: '检查中',
  PAUSING: '暂停中',
  PAUSED: '已暂停',
  CANCELLING: '取消中',
  CANCELLED: '已取消',
  FAILED: '已中断',
  COMPLETED: '已完成',
  SKIPPED: '未执行'
}

const stageLabels = {
  STAT: '正在核对作品',
  CANDIDATES: '正在筛选候选作品',
  HASH: '正在检查候选内容',
  GROUP: '正在整理结果',
  DONE: '检查完成'
}

function runHeading(run: ArtworkDedupRunDto) {
  switch (run.status) {
    case 'PENDING':
      return '等待开始检查'
    case 'RETRY_WAIT':
      return '等待重新尝试'
    case 'RUNNING':
      return stageLabels[run.stage]
    case 'PAUSING':
      return '正在暂停检查'
    case 'PAUSED':
      return '检查已暂停'
    case 'CANCELLING':
      return '正在取消检查'
    case 'CANCELLED':
      return '检查已取消'
    case 'FAILED':
      return '检查中断'
    case 'SKIPPED':
      return '检查未执行'
    case 'COMPLETED':
      if (run.counts.artworks === 0) return '没有可检查的作品'
      if (run.counts.failedArtworks + run.counts.changedArtworks + run.counts.skippedArtworks > 0) {
        return '检查完成，有未检查项'
      }
      return run.counts.groups > 0
        ? `找到 ${run.counts.groups.toLocaleString('zh-CN')} 组内容相同的作品`
        : '没有找到重复作品'
  }
}

function runDescription(run: ArtworkDedupRunDto) {
  switch (run.status) {
    case 'PAUSING':
      return '正在保存进度，等待后台确认暂停。'
    case 'PAUSED':
      return '继续后会接着检查本次范围内未完成的作品。'
    case 'CANCELLING':
      return '正在停止后续检查，等待后台确认。'
    case 'CANCELLED':
      return '已保存的检查进度会保留。'
    case 'FAILED':
      return run.failure?.message ?? '暂时无法完成检查，请稍后重试。'
    case 'COMPLETED':
      return run.counts.artworks === 0 ? '该艺术家当前没有可检查的作品。' : '本次检测结果已保存。'
    case 'SKIPPED':
      return '本次检查没有执行。'
    default:
      return '离开页面后，检查仍会在后台进行。'
  }
}

const controlLabels = { pause: '暂停', resume: '继续检查', retry: '重试检查' } as const
const controlIcons = { pause: Pause, resume: Play, retry: RotateCcw }

export function DuplicateRunStatus({
  run,
  pending,
  disabled,
  onControl
}: {
  run: ArtworkDedupRunDto
  pending: ArtworkDedupControlAction | 'start' | null
  disabled: boolean
  onControl: (action: ArtworkDedupControlAction) => void
}) {
  const { counts } = run
  const unchecked = counts.changedArtworks + counts.failedArtworks + counts.skippedArtworks
  const progress = counts.artworks > 0 ? Math.min(100, (counts.processedArtworks / counts.artworks) * 100) : null
  const heading = runHeading(run)

  return (
    <section aria-labelledby="duplicate-run-title" className="flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0" aria-live="polite" aria-atomic="true">
          <AdminStatusBadge status={run.status}>{statusLabels[run.status]}</AdminStatusBadge>
          <h2 id="duplicate-run-title" className="mt-3 text-lg font-semibold">
            {heading}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{runDescription(run)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2" aria-busy={Boolean(pending)}>
          {(['pause', 'resume', 'retry'] as const)
            .filter((action) => run.allowedControls.includes(action))
            .map((action) => {
              const Icon = controlIcons[action]
              return (
                <Button
                  key={action}
                  type="button"
                  className="min-h-11"
                  variant={action === 'pause' ? 'outline' : 'default'}
                  disabled={disabled}
                  onClick={() => onControl(action)}
                >
                  {pending === action ? (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  ) : (
                    <Icon data-icon="inline-start" aria-hidden="true" />
                  )}
                  {controlLabels[action]}
                </Button>
              )
            })}
          {run.allowedControls.includes('cancel') ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  className="min-h-11 min-w-11"
                  variant="outline"
                  size="icon"
                  disabled={disabled}
                  aria-label="更多检查操作"
                >
                  {pending === 'cancel' ? <Spinner aria-hidden="true" /> : <MoreHorizontal aria-hidden="true" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem className="min-h-11" onSelect={() => onControl('cancel')} disabled={disabled}>
                    <X aria-hidden="true" />
                    取消检查
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      {counts.artworks > 0 ? (
        <div className="flex max-w-2xl flex-col gap-3">
          <p className="text-sm tabular-nums">
            已处理 {counts.processedArtworks.toLocaleString('zh-CN')} / {counts.artworks.toLocaleString('zh-CN')} 部作品
          </p>
          <Progress
            value={progress}
            aria-label="作品检查进度"
            aria-valuetext={`已处理 ${counts.processedArtworks} / ${counts.artworks} 部作品`}
            className="h-1.5"
          />
          {unchecked > 0 ? (
            <p className="text-sm text-muted-foreground">
              其中 {unchecked.toLocaleString('zh-CN')} 部未完成检查
              {run.status === 'COMPLETED' && counts.groups > 0
                ? `；已找到 ${counts.groups.toLocaleString('zh-CN')} 组内容相同的作品`
                : ''}
              。
            </p>
          ) : null}
        </div>
      ) : null}
      <dl className="flex flex-wrap gap-x-8 gap-y-4 text-sm">
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">检查范围</dt>
          <dd className="tabular-nums">开始时的 {counts.artworks.toLocaleString('zh-CN')} 部作品</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">检查方式</dt>
          <dd>{run.mode === 'FULL' ? '完整检查' : '增量检查'}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">范围确定于</dt>
          <dd>
            {new Date(run.frozenAt).toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            })}
          </dd>
        </div>
      </dl>
      {run.failure ? (
        <details className="text-sm">
          <summary className="w-fit min-h-11 cursor-pointer py-3 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            查看诊断
          </summary>
          <p className="py-2 font-mono text-xs break-all">{run.failure.code}</p>
        </details>
      ) : null}
    </section>
  )
}
