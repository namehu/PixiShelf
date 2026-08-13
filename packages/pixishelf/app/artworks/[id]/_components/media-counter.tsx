'use client'

import { ImageIcon, VideoIcon } from 'lucide-react'
import { useArtworkStore } from '@/store/use-artwork-store'
import { useShallow } from 'zustand/react/shallow'

interface MediaCounterProps {
  hasVideo: boolean
  ext?: string
}

export default function MediaCounter({ hasVideo, ext }: MediaCounterProps) {
  const { currentIndex, total } = useArtworkStore(
    useShallow((state) => ({
      currentIndex: state.currentIndex,
      total: state.total
    }))
  )

  if (total === 0) return null

  return (
    <div className="flex max-w-full items-center gap-1 overflow-hidden text-muted-foreground sm:gap-2">
      <div className="flex min-w-0 items-center gap-1">
        {hasVideo ? (
          <>
            <VideoIcon className="size-4" aria-hidden="true" />
            <span className="font-utility whitespace-nowrap text-xs sm:text-sm">
              <span className="font-medium text-foreground">{ext}</span>
            </span>
          </>
        ) : (
          <>
            <ImageIcon className="size-4" aria-hidden="true" />
            <span className="font-utility whitespace-nowrap text-xs sm:text-sm">
              <span className="font-medium text-foreground">{currentIndex + 1}</span>
              <span className="mx-0.5 text-muted-foreground sm:mx-1">/</span>
              <span>{total}</span>
            </span>
          </>
        )}
      </div>
    </div>
  )
}
