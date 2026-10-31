import { Loader2Icon, PauseIcon, PlayIcon } from 'lucide-react'
import type { VideoInteractionFeedback } from '@/components/players/video-interaction-core'

export function ViewerGestureFeedback({
  feedback,
  buffering
}: {
  feedback: VideoInteractionFeedback | null
  buffering: boolean
}) {
  if (!feedback && !buffering) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center" aria-live="polite">
      <div className="flex min-h-16 min-w-16 flex-col items-center justify-center rounded-2xl bg-black/55 px-4 py-3 text-center text-white backdrop-blur-sm">
        {buffering && !feedback ? (
          <Loader2Icon className="size-7 animate-spin" />
        ) : feedback?.kind === 'playback' ? (
          feedback.title === '播放' ? (
            <PlayIcon className="size-7 fill-current" />
          ) : (
            <PauseIcon className="size-7 fill-current" />
          )
        ) : (
          <span className="text-sm font-semibold">{feedback?.title}</span>
        )}
        {feedback?.detail && <span className="mt-1 text-xs text-white/70">{feedback.detail}</span>}
      </div>
    </div>
  )
}
