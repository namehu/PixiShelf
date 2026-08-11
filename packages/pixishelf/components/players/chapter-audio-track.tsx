'use client'

import type { NormalizedChapter } from './video-chapters'

interface ChapterAudioTrackProps {
  chapters: NormalizedChapter[]
  duration: number
}

export default function ChapterAudioTrack({ chapters, duration }: ChapterAudioTrackProps) {
  const hasKnownAudioState = chapters.some((chapter) => typeof chapter.hasAudio === 'boolean')
  if (!hasKnownAudioState || !Number.isFinite(duration) || duration <= 0) return null

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-0.5 overflow-hidden rounded-full"
      aria-hidden="true"
      data-testid="chapter-audio-track"
    >
      {chapters.map((chapter) => {
        if (typeof chapter.hasAudio !== 'boolean') return null
        const left = Math.min(Math.max((chapter.start / duration) * 100, 0), 100)
        const right = Math.min(Math.max((chapter.end / duration) * 100, left), 100)

        return (
          <span
            key={chapter.id}
            className={chapter.hasAudio ? 'absolute inset-y-0 bg-blue-400' : 'absolute inset-y-0 bg-neutral-500'}
            style={{ left: `${left}%`, width: `${right - left}%` }}
          />
        )
      })}
    </div>
  )
}
