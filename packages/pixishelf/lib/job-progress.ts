import type { ArtworkDedupProgressData, JobProgressData, JobStatus } from '@pixishelf/job-contracts'

const dedupPhaseLabels: Record<ArtworkDedupProgressData['phase'], string> = {
  ORIGINALS: '正在核对原件',
  FEATURES: '正在准备图片特征',
  INDEX: '正在准备图片检索',
  VISUAL: '正在比较图片',
  PAIR: '正在检查作品关系',
  PUBLISH: '正在保存结果',
  COMPLETED: '检查已完成'
}

const legacyDedupStageLabels: Record<string, string> = {
  STAT: '正在核对作品',
  CANDIDATES: '正在比对作品',
  HASH: '正在比对文件内容',
  MATCH: '正在检查作品关系',
  VISUAL: '正在检查疑似版本',
  GROUP: '正在整理结果',
  DONE: '正在保存结果'
}

const dedupUnitLabels: Record<ArtworkDedupProgressData['unit'], string> = {
  media: '项原件',
  images: '张图片',
  artworks: '部作品',
  pairs: '对作品',
  batches: '批'
}

const dedupWaitLabels: Record<NonNullable<ArtworkDedupProgressData['waitReason']>, string> = {
  SCHEDULER: '等待后台调度，将自动继续',
  SOURCE_WRITE: '等待媒体写入完成，将自动继续',
  RETRY: '等待后台重试，将自动继续',
  USER_PAUSED: '检查已暂停，需手动继续',
  VISUAL_COMPARISON_BUDGET: '本轮比较已达上限，需继续检查'
}

export function artworkDedupProgressPresentation(input: {
  status: JobStatus
  stage?: string | null
  progressData?: JobProgressData | null
}) {
  const progress = input.progressData?.kind === 'artwork-dedup' ? input.progressData : null
  const phaseLabel =
    input.status === 'COMPLETED'
      ? '检查已完成'
      : progress
        ? dedupPhaseLabels[progress.phase === 'COMPLETED' ? 'PUBLISH' : progress.phase]
        : legacyDedupStageLabels[input.stage ?? ''] ?? '正在检查作品'
  let countLabel: string | null = null
  let value: number | null = null
  if (progress && progress.completed !== null) {
    if (progress.total !== null && progress.total > 0) {
      countLabel = `${progress.completed.toLocaleString('zh-CN')} / ${progress.total.toLocaleString('zh-CN')}`
      value = Math.min(100, (progress.completed / progress.total) * 100)
    } else if (progress.total === null) {
      countLabel = `已处理 ${progress.completed.toLocaleString('zh-CN')} ${dedupUnitLabels[progress.unit]}`
    }
  }
  let waitLabel: string | null = null
  if (input.status === 'PAUSING') waitLabel = '正在保存进度，等待后台确认暂停'
  else if (input.status === 'PAUSED') {
    waitLabel = progress?.waitReason === 'VISUAL_COMPARISON_BUDGET'
      ? '本轮比较已达上限，需继续检查'
      : '检查已暂停，需手动继续'
  }
  else if (input.status === 'CANCELLING') waitLabel = '正在取消检查'
  else if (input.status === 'CANCELLED') waitLabel = '检查已取消'
  else if (input.status === 'FAILED') waitLabel = '检查中断，可重试检查'
  else if (input.status === 'SKIPPED') waitLabel = '检查未执行'
  else if (input.status === 'PENDING' || input.status === 'RETRY_WAIT' || input.status === 'RUNNING') {
    waitLabel = progress?.waitReason
      ? dedupWaitLabels[progress.waitReason]
      : input.status === 'RETRY_WAIT'
        ? '等待后台重试，将自动继续'
        : input.status === 'PENDING' ? '等待后台调度，将自动开始' : null
  }

  return {
    phaseLabel,
    countLabel,
    label: countLabel ? `${phaseLabel} · ${countLabel}` : phaseLabel,
    value,
    waitLabel,
    uncheckedMedia: progress?.uncheckedMedia ?? null,
    hasSnapshot: progress !== null,
    isComplete: input.status === 'COMPLETED'
  }
}
