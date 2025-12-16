import VideoPlayer from '@/components/ui/VideoPlayer'
import { useArtworkStore } from '@/store/useArtworkStore'
import Image from 'next/image'
import { memo, useEffect } from 'react'
import { useInView } from 'react-intersection-observer'
import { isVideoFile } from '../../../../../lib/media'

/**
 * 懒加载媒体组件
 * 逻辑升级：直接与 Zustand 通信，不回调父组件
 */
const LazyMedia = memo(function LazyMedia({ src, index }: { src: string; index: number }) {
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const isVideo = isVideoFile(src)

  const { ref, inView } = useInView({
    rootMargin: '-45% 0px -45% 0px', // 只有当图片穿过屏幕中间区域时，inView 才会变为 true。
    threshold: 0
  })

  // 当进入“中心区域”时，更新全局索引
  useEffect(() => {
    if (inView) {
      setCurrentIndex(index)
    }
  }, [inView, index, setCurrentIndex])

  return (
    <div ref={ref} className="overflow-hidden bg-neutral-100 flex items-center justify-center  relative">
      {isVideo ? (
        <VideoPlayer src={`/api/v1/images/${encodeURIComponent(src)}`} className="w-full h-auto" preload="metadata" />
      ) : (
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
      )}
    </div>
  )
})

export default LazyMedia
