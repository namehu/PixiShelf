'use client'

import VideoPlayer from '@/components/players/VideoPlayer'
import ApngPlayer from '@/components/players/ApngPlayer'
import AnimatedWebpPlayer from '@/components/players/AnimatedWebpPlayer'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkStore } from '@/store/useArtworkStore'
import Image from 'next/image'
import { memo } from 'react'
import { useOnInView } from 'react-intersection-observer'
import { isApngFile, isVideoFile, isWebpFile } from '@/lib/media'
import { EWebpAnimationStatus } from '@/enums/EWebpAnimationStatus'

interface LazyMediaProps {
  media: ArtworkImageResponseDto
  index: number
}

/**
 * 懒加载媒体组件
 */
const LazyMedia = memo(({ media, index }: LazyMediaProps) => {
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const src = media.path

  const trackingRef = useOnInView(
    (inView) => {
      if (inView) setCurrentIndex(index)
    },
    { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
  )

  // 主渲染逻辑
  const renderContent = () => {
    if (isVideoFile(src)) {
      return <VideoPlayer src={src} chaptersUrl={media.chaptersUrl} className="w-full h-auto" preload="metadata" />
    }

    if (isApngFile(src)) {
      return <ApngPlayer src={src} alt={`Artwork animation ${index + 1}`} />
    }

    if (isWebpFile(src)) {
      return (
        <AnimatedWebpPlayer
          src={src}
          alt={`Artwork WebP ${index + 1}`}
          size={media.size}
          isAnimated={media.webpAnimationStatus === EWebpAnimationStatus.animated}
        />
      )
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
