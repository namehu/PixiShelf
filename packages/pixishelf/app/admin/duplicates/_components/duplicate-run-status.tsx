import type { ArtworkDedupControlAction, ArtworkDedupRunDto } from '@pixishelf/job-contracts'
import { CircleAlert, CircleCheck, Info, MoreHorizontal, Pause, Play, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'

export function isDuplicateRunActive(run: ArtworkDedupRunDto) {
  return ['PENDING', 'RETRY_WAIT', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING'].includes(run.status)
}

const stageLabels = {
  STAT: '正在核对作品',
  CANDIDATES: '正在比对作品',
  HASH: '正在比对文件内容',
  MATCH: '正在检查作品关系',
  VISUAL: '正在检查疑似版本',
  GROUP: '正在整理结果',
  DONE: '检查完成'
}

function runHeading(run: ArtworkDedupRunDto) {
  switch (run.status) {
    case 'PENDING':
      return '等待开始检查'
    case 'RETRY_WAIT':
      return '等待继续检查'
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
      if (
        run.counts.failedArtworks + run.counts.changedArtworks + run.counts.skippedArtworks > 0 ||
        run.visualStatus === 'INCOMPLETE'
      ) {
        return '检查完成，有未检查项'
      }
      return run.counts.groups > 0
        ? `找到 ${run.counts.groups.toLocaleString('zh-CN')} 组待处理作品`
        : '没有找到重复作品'
  }
}

function runDescription(run: ArtworkDedupRunDto) {
  switch (run.status) {
    case 'PAUSING':
      return '正在保存进度，等待后台确认暂停。'
    case 'PAUSED':
      if (run.failure) return run.failure.message
      return run.pauseReason === 'VISUAL_COMPARISON_BUDGET'
        ? '本轮疑似版本比较已达上限，继续后会接着检查。'
        : '继续后会接着检查本次范围内未完成的作品。'
    case 'CANCELLING':
      return '正在停止后续检查，等待后台确认。'
    case 'CANCELLED':
      return '已保存的检查进度会保留。'
    case 'FAILED':
      return run.failure?.message ?? '暂时无法完成检查，请稍后重试。'
    case 'COMPLETED':
      if (run.counts.failedArtworks + run.counts.changedArtworks + run.counts.skippedArtworks > 0) {
        return `${run.counts.failedArtworks + run.counts.changedArtworks + run.counts.skippedArtworks} 部作品未完成检查，重新检查后再处理。`
      }
      return run.counts.artworks === 0
        ? '该艺术家当前没有可检查的作品。'
        : run.counts.groups > 0
          ? '核对作品差异后，选择需要处理的结果。'
          : '可以继续浏览，新增作品后再来检查。'
    case 'SKIPPED':
      return '本次检查没有执行。'
    default:
      return '离开页面后，检查仍会在后台进行。'
  }
}

export function duplicateVisualIncompleteReason(reason: string) {
  const labels: Record<string, string> = {
    VISUAL_FILE_BUDGET: '超过本次 10,000 个登记原件上限',
    VISUAL_ARTWORK_BUDGET: '部分作品超过 2,000 张图片上限',
    VISUAL_INDEX_BUDGET: '达到本次检索索引上限',
    VISUAL_POSTING_BUDGET: '达到本次检索上限',
    VISUAL_CANDIDATE_BUDGET: '达到本次候选上限',
    VISUAL_COMPARISON_BUDGET: '达到本次比较上限',
    VISUAL_PAIR_BUDGET: '达到本次作品对上限',
    VISUAL_EDGE_BUDGET: '部分作品对达到图片配对上限',
    INCOMPLETE_ORIGINALS: '部分作品原件未完成检查',
    RUN_FILE_LIMIT: '超过本次 10,000 个登记原件上限',
    ARTWORK_FILE_LIMIT: '部分作品超过 2,000 张图片上限',
    UNSUPPORTED_MEDIA: '部分作品含动画、视频或不支持的图片',
    INPUT_UNSUPPORTED: '部分作品含不支持的图片',
    INPUT_LIMIT: '部分图片超过读取上限',
    READ_FAILED: '部分图片无法读取',
    FEATURE_FAILED: '部分图片未完成视觉检查',
    INDEX_LIMIT: '达到本次检索上限',
    QUERY_LIMIT: '达到本次检索上限',
    CANDIDATE_LIMIT: '达到本次候选上限',
    COMPARISON_LIMIT: '达到本次比较上限',
    PAIR_LIMIT: '达到本次作品对上限'
  }
  return labels[reason] ?? '部分图片未完成检查'
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
    <section
      aria-labelledby="duplicate-run-title"
      className="my-3 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:px-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 basis-52 items-start gap-2.5 py-1.5" aria-live="polite" aria-atomic="true">
          {unchecked > 0 || run.failure ? (
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          ) : run.status === 'COMPLETED' ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          ) : null}
          <div className="min-w-0">
            <h2 id="duplicate-run-title" className="text-sm leading-5 font-medium">
              {heading}
            </h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{runDescription(run)}</p>
            {run.visualStatus === 'INCOMPLETE' ? (
              <p className="mt-1 text-xs leading-5 text-warning">
                疑似版本未全部检查：
                {run.visualIncompleteReasons.map(duplicateVisualIncompleteReason).join('；') ||
                  '部分图片不支持或达到本次检查上限'}
                。其他重复结果仍可核对。
              </p>
            ) : run.visualStatus === 'COMPLETE' ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                疑似版本检查已完成，仍可能有遗漏，请逐张核对。
              </p>
            ) : null}
            {!run.includesPartial ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">此记录未检查部分重复。</p>
            ) : null}
            {!run.includesContainment ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                此记录只检查了完全相同的作品，重新检查可查完整包含
              </p>
            ) : null}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1" aria-busy={Boolean(pending)}>
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
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-11" aria-label="检查详情">
                <Info className="text-muted-foreground" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label="检查详情" align="end" className="w-72 max-w-[calc(100vw-2rem)] text-sm">
              <p className="font-medium">检查详情</p>
              <p className="mt-2 text-muted-foreground">
                本次检查 {counts.artworks.toLocaleString('zh-CN')} 部作品 ·{' '}
                {run.mode === 'FULL' ? '逐一重查' : '快速检查'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                开始于 {new Date(run.frozenAt).toLocaleString('zh-CN')}
              </p>
              {run.failure ? <p className="mt-3 font-mono text-xs break-all">{run.failure.code}</p> : null}
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {counts.artworks > 0 && run.status !== 'COMPLETED' ? (
        <div className="flex flex-col gap-2 pt-1 pb-2">
          <p className="text-xs text-muted-foreground tabular-nums">
            已处理 {counts.processedArtworks.toLocaleString('zh-CN')} / {counts.artworks.toLocaleString('zh-CN')} 部作品
          </p>
          <Progress
            value={progress}
            aria-label="作品检查进度"
            aria-valuetext={`已处理 ${counts.processedArtworks} / ${counts.artworks} 部作品`}
            className="h-1.5"
          />
          {unchecked > 0 ? (
            <p className="text-xs text-muted-foreground">其中 {unchecked.toLocaleString('zh-CN')} 部未完成检查。</p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
