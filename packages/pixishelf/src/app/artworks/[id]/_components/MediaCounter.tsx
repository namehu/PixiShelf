'use client'

import { ImageIcon, VideoIcon } from 'lucide-react'
import { useArtworkStore } from '@/store/useArtworkStore'
import { useShallow } from 'zustand/react/shallow'

interface MediaCounterProps {
  hasVideo: boolean
}

export default function MediaCounter({ hasVideo }: MediaCounterProps) {
  const { currentIndex, total } = useArtworkStore(
    useShallow((state) => ({
      currentIndex: state.currentIndex,
      total: state.total
    }))
  )

  if (total === 0) return null

  return (
    <div className="flex items-center gap-1 sm:gap-2 text-neutral-500 max-w-full overflow-hidden">
      <div className="flex items-center gap-1 min-w-0">
        {hasVideo ? <VideoIcon size={16} /> : <ImageIcon size={16} />}
        <span className="font-mono text-xs sm:text-sm whitespace-nowrap">
          <span className="text-neutral-900 font-medium">{currentIndex + 1}</span>
          <span className="mx-0.5 sm:mx-1 text-neutral-400">/</span>
          <span className="text-neutral-600">{total}</span>
        </span>
      </div>
    </div>
  )
}
