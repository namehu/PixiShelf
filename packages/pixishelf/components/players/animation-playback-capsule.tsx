import { PauseIcon, PlayIcon, SquareIcon } from 'lucide-react'

interface AnimationPlaybackCapsuleProps {
  playing: boolean
  playOnce?: boolean
  label: string
  fileSize?: string | null
  progressPercent?: number | null
}

export function formatAnimationFileSize(size?: number | null) {
  if (!size || size <= 0) return null

  const mb = size / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)}MB`

  const kb = size / 1024
  return `${Math.max(kb, 1).toFixed(0)}KB`
}

export function animationPlaybackLabel(
  playing: boolean,
  playOnce: boolean,
  formatLabel: string,
  progressPercent?: number | null
) {
  return `${playing && playOnce ? '停止本轮动图' : `${playing ? '暂停' : '播放'} ${formatLabel} 动图`}${progressPercent === null || progressPercent === undefined ? '' : `，${progressPercent}%`}`
}

/** Shared visible control; its parent supplies the 44px pointer and keyboard target. */
export function AnimationPlaybackCapsule({
  playing,
  playOnce = false,
  label,
  fileSize,
  progressPercent
}: AnimationPlaybackCapsuleProps) {
  return (
    <span className="relative flex h-[22px] items-center justify-center gap-1 overflow-hidden rounded-full bg-[#ff2f4d] px-2 text-xs font-semibold leading-none tabular-nums text-white shadow-sm">
      {progressPercent !== null && progressPercent !== undefined && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 bg-white/25"
          style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
          data-animation-progress-fill
        />
      )}
      <span className="relative z-10 flex items-center gap-1">
        {playing ? (
          playOnce ? <SquareIcon className="size-3 fill-current" /> : <PauseIcon className="size-3 fill-current" />
        ) : (
          <PlayIcon className="size-3 fill-current" />
        )}
        <span>{label}</span>
        {!playing && fileSize && <span>{fileSize}</span>}
      </span>
    </span>
  )
}
