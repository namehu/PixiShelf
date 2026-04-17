'use client'

import { Swiper, SwiperSlide } from 'swiper/react'
import { Mousewheel, Keyboard } from 'swiper/modules'
import ImageSlide from './ImageSlide'
import { Eye, EyeOff } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import type { Swiper as SwiperType } from 'swiper'

// 导入 Swiper 的核心和模块样式
import 'swiper/css'
import 'swiper/css/mousewheel'
import 'swiper/css/keyboard'
import { RandomImageItem } from '@/types/images'
import { useViewerStore } from '@/store/viewerStore'
import { Placeholder } from './Placeholder'
import { useShallow } from 'zustand/react/shallow'

interface ImmersiveImageViewerProps {
  initialImages: RandomImageItem[]
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void
}

/**
 * 沉浸式图片浏览器组件
 * 使用Swiper实现垂直滑动切换，支持无限滚动加载
 * 集成状态管理，支持浏览位置恢复
 */
export default function ImmersiveImageViewer({
  initialImages,
  onLoadMore,
  hasMore,
  isLoading
}: ImmersiveImageViewerProps) {
  const { setVerticalIndex, verticalIndex, isChromeHidden, setChromeHidden } = useViewerStore(
    useShallow((state) => ({
      verticalIndex: state.verticalIndex,
      setVerticalIndex: state.setVerticalIndex,
      isChromeHidden: state.isChromeHidden,
      setChromeHidden: state.setChromeHidden
    }))
  )

  // 处理slide变化
  const handleSlideChange = useCallback(
    (swiper: SwiperType) => {
      setVerticalIndex(swiper.activeIndex)
    },
    [setVerticalIndex]
  )

  const handleToggleChrome = useCallback(() => {
    const nextHidden = !isChromeHidden
    setChromeHidden(nextHidden)
    if (nextHidden) {
      toast.success('已清屏播放')
    }
  }, [isChromeHidden, setChromeHidden])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName

      if (target?.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return
      }

      if (event.key.toLowerCase() === 'c' || event.code === 'Space') {
        event.preventDefault()
        handleToggleChrome()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleToggleChrome])

  return (
    // PC端适配容器
    <div className="w-full h-full bg-black md:flex md:items-center md:justify-center">
      {/* 沉浸式查看器主容器 */}
      <div className="immersive-container h-full w-full md:max-w-[420px] md:h-[90vh] md:aspect-[9/16] md:rounded-lg relative bg-neutral-900">
        <button
          type="button"
          className="absolute top-4 left-4 z-50 hidden h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/50 md:flex"
          onClick={handleToggleChrome}
          aria-label={isChromeHidden ? '显示界面' : '清屏播放'}
        >
          {isChromeHidden ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
        </button>
        <Swiper
          initialSlide={verticalIndex}
          direction="vertical"
          className="h-full w-full"
          // PC配置
          mousewheel={true}
          keyboard={{ enabled: true }}
          modules={[Mousewheel, Keyboard]}
          // 初始索引配置
          slidesPerView={1}
          lazyPreloadPrevNext={0}
          resistance={true}
          resistanceRatio={0.85}
          speed={300}
          touchRatio={1}
          touchAngle={45}
          grabCursor={true}
          onReachEnd={() => {
            if (hasMore && !isLoading) {
              onLoadMore()
            }
          }}
          onSlideChange={handleSlideChange}
        >
          {initialImages.map((image, index) => {
            // 1. 判断当前幻灯片是否是用户正在看的
            const isActive = index === verticalIndex
            // 2. 判断当前幻灯片是否是需要预加载的（即下一个或上一个）
            const isPreloading = Math.abs(index - verticalIndex) === 1
            // 3. 只有“活动”和“预加载”的幻灯片才会被渲染，其他都是占位符
            const shouldRender = isActive || isPreloading

            return (
              <SwiperSlide key={image.key} className=" flex w-full h-ful items-center justify-center overflow-hidden">
                <div className="relative w-full h-full bg-black">
                  {shouldRender ? (
                    <ImageSlide isActive={isActive} isPreloading={isPreloading} image={image} />
                  ) : (
                    <Placeholder />
                  )}
                </div>
              </SwiperSlide>
            )
          })}

          {/* 如果没有更多数据，显示结束提示 */}
          {!hasMore && initialImages.length > 0 && (
            <SwiperSlide className="flex items-center justify-center text-white">
              <div className="text-center">
                <p className="text-sm opacity-60">没有更多图片了</p>
              </div>
            </SwiperSlide>
          )}
        </Swiper>
      </div>
    </div>
  )
}
