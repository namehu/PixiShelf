import { ImageIcon, VideoIcon } from 'lucide-react'

interface MediaCounterProps {
  isVideo: boolean
  currentImageIndex: number
  total: number
}
/**
 * 媒体序号指示器组件
 */
export default function MediaCounter({ isVideo, currentImageIndex, total }: MediaCounterProps) {
  return (
    <div className="flex items-center gap-1 sm:gap-2 text-neutral-500 max-w-full overflow-hidden">
      <div className="flex items-center gap-1 min-w-0">
        {isVideo ? <VideoIcon size={16} /> : <ImageIcon size={16} />}
        <span className="font-mono text-xs sm:text-sm whitespace-nowrap">
          <span className="text-neutral-900 font-medium">{currentImageIndex + 1}</span>
          <span className="mx-0.5 sm:mx-1 text-neutral-400">/</span>
          <span className="text-neutral-600">{total}</span>
        </span>
      </div>
    </div>
  )
}
