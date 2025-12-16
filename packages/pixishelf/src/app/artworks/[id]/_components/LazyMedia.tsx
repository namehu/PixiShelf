import VideoPlayer from '@/components/ui/VideoPlayer'
import { useArtworkStore } from '@/store/useArtworkStore'
import Image from 'next/image'
import { memo } from 'react'
import { useOnInView } from 'react-intersection-observer'
import { isApngFile, isVideoFile } from '../../../../../lib/media'
import ApngPlayer from './ApngPlayer'
import { combinationApiResource } from '@/utils/combinationStatic'

/**
 * 懒加载媒体组件
 */
const LazyMedia = memo(({ src, index }: { src: string; index: number }) => {
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)

  const trackingRef = useOnInView(
    (inView) => {
      if (inView) setCurrentIndex(index)
    },
    {
      rootMargin: '-45% 0px -45% 0px',
      threshold: 0
    }
  )

  // 主渲染逻辑
  const renderContent = () => {
    if (isVideoFile(src)) {
      return <VideoPlayer src={combinationApiResource(src)} className="w-full h-auto" preload="metadata" />
    }

    if (isApngFile(src)) {
      return <ApngPlayer src={src} alt={`Artwork animation ${index + 1}`} />
    }

    // 普通图片
    return (
      <Image
        src={src}
        alt={`Artwork part ${index + 1}`}
        priority={index < 4}
        loading={index < 4 ? 'eager' : 'lazy'}
        width={0}
        height={0}
        sizes="100vw"
        className="w-full h-auto min-h-[300px] sm:min-h-[500px]"
      />
    )
  }

  return (
    <div ref={trackingRef} className="overflow-hidden bg-neutral-100 flex items-center justify-center relative">
      {renderContent()}
    </div>
  )
})

export default LazyMedia
