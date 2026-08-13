'use client'

import Image from 'next/image'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useActiveItemVisibility } from './use-active-item-visibility'
import { formatVideoKeyframeTime, type NormalizedVideoKeyframe } from './video-keyframes'

interface VideoKeyframeSidebarProps {
  keyframes: NormalizedVideoKeyframe[]
  currentKeyframeId?: string
  onKeyframeClick: (keyframe: NormalizedVideoKeyframe) => void
  className?: string
  scrollAreaClassName?: string
  tone?: 'dark' | 'light'
  layout?: 'grid' | 'horizontal'
}

export default function VideoKeyframeSidebar({
  keyframes,
  currentKeyframeId,
  onKeyframeClick,
  className,
  scrollAreaClassName,
  tone = 'dark',
  layout = 'grid'
}: VideoKeyframeSidebarProps) {
  const { viewportRef, setItemRef, interactionProps } = useActiveItemVisibility(currentKeyframeId)
  if (keyframes.length === 0) return null

  const isLight = tone === 'light'
  const renderKeyframe = (keyframe: NormalizedVideoKeyframe) => {
    const isActive = currentKeyframeId === keyframe.id
    const time = formatVideoKeyframeTime(keyframe.captureTime)

    return (
      <button
        key={keyframe.id}
        ref={setItemRef(keyframe.id)}
        type="button"
        onClick={() => onKeyframeClick(keyframe)}
        aria-label={`跳转到画面 ${time}`}
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          'group relative aspect-video min-w-0 overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
          layout === 'horizontal' && 'pixishelf-keyframe-card-horizontal shrink-0 snap-start',
          isActive
            ? isLight
              ? 'border-blue-500 ring-1 ring-blue-500'
              : 'border-blue-400 ring-1 ring-blue-400'
            : isLight
              ? 'border-neutral-200 bg-neutral-100 hover:border-neutral-300'
              : 'border-white/10 bg-black/50 hover:border-white/25'
        )}
      >
        <Image
          src={keyframe.url}
          alt={`视频画面 ${time}`}
          fill
          sizes={layout === 'horizontal' ? '50vw' : '(min-width: 1024px) 220px, 50vw'}
          className="object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
        <span
          className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/75 to-transparent"
          aria-hidden="true"
        />
        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
          {time}
        </span>
      </button>
    )
  }

  return (
    <aside
      data-keyframe-layout={layout}
      className={cn(
        'flex min-h-0 flex-col rounded-lg border',
        isLight ? 'border-neutral-200 bg-white' : 'border-white/10 bg-black/30',
        className
      )}
      {...interactionProps}
    >
      {layout === 'horizontal' ? (
        <div
          ref={viewportRef}
          className={cn(
            'flex min-h-0 flex-1 snap-x snap-mandatory items-start gap-3 overflow-x-auto px-3 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            scrollAreaClassName
          )}
        >
          {keyframes.map(renderKeyframe)}
        </div>
      ) : (
        <ScrollArea viewportRef={viewportRef} className={cn('flex-1', scrollAreaClassName || 'max-h-72 sm:max-h-96')}>
          <div className="grid grid-cols-2 gap-2 p-2">{keyframes.map(renderKeyframe)}</div>
        </ScrollArea>
      )}
    </aside>
  )
}
