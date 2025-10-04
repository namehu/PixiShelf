'use client'

import { Swiper, SwiperSlide } from 'swiper/react'
import { Mousewheel, Keyboard } from 'swiper/modules'
import ImageSlide from './ImageSlide'
import { useCallback, useState, useEffect, useRef } from 'react'
import type { Swiper as SwiperType } from 'swiper'

// 导入 Swiper 的核心和模块样式
import 'swiper/css'
import 'swiper/css/mousewheel'
import 'swiper/css/keyboard'
import { RandomImageItem } from '@/types/images'
import { useViewerStore } from '@/store/viewerStore'
import { Placeholder } from './Placeholder'

interface ImmersiveImageViewerProps {
  initialImages: RandomImageItem[]
  initialIndex?: number // 初始显示的图片索引，用于状态恢复
  onLoadMore: () => void // 加载更多的回调函数
  hasMore: boolean
  isLoading: boolean
}

/**
 * 沉浸式图片浏览器组件
 * 使用Swiper实现垂直滑动切换，支持无限滚动加载
 * 集成状态管理，支持浏览位置恢复
 */
export default function ImmersiveImageViewer({
  initialImages,
  initialIndex = 0,
  onLoadMore,
  hasMore,
  isLoading
}: ImmersiveImageViewerProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex)
  const swiperRef = useRef<SwiperType | null>(null)
  const { setVerticalIndex } = useViewerStore()

  // 处理滑动到底部的回调
  const handleReachEnd = useCallback(() => {
    if (hasMore && !isLoading) {
      onLoadMore()
    }
  }, [hasMore, isLoading, onLoadMore])

  // 处理slide变化
  const handleSlideChange = useCallback(
    (swiper: SwiperType) => {
      const newIndex = swiper.activeIndex
      setActiveIndex(newIndex)
      // 同步到状态管理
      setVerticalIndex(newIndex)
    },
    [setVerticalIndex]
  )

  // 状态恢复：当初始索引变化时，滑动到对应位置
  useEffect(() => {
    if (swiperRef.current && initialIndex > 0 && initialIndex < initialImages.length) {
      // 延迟执行，确保 Swiper 已经完全初始化
      const timer = setTimeout(() => {
        swiperRef.current?.slideTo(initialIndex, 0) // 0ms 动画时间，立即跳转
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [initialIndex, initialImages.length])

  // Swiper 初始化回调
  const handleSwiperInit = useCallback((swiper: SwiperType) => {
    swiperRef.current = swiper
  }, [])

  return (
    // PC端适配容器
    <div className="w-full h-full bg-black md:flex md:items-center md:justify-center">
      {/* 沉浸式查看器主容器 */}
      <div className="immersive-container h-full w-full md:max-w-[420px] md:h-[90vh] md:aspect-[9/16] md:rounded-lg relative bg-neutral-900">
        <Swiper
          // 关键配置：垂直方向
          direction="vertical"
          // 在PC上启用鼠标滚轮
          mousewheel={true}
          // 在PC上启用键盘上下键
          keyboard={{ enabled: true }}
          modules={[Mousewheel, Keyboard]}
          className="h-full w-full"
          // 初始索引配置
          initialSlide={initialIndex}
          // 关键事件：当滑动到最后一个 slide 时触发
          onReachEnd={handleReachEnd}
          // 处理slide变化
          onSlideChange={handleSlideChange}
          // Swiper 初始化回调
          onSwiper={handleSwiperInit}
          // 为了更好的性能，只渲染激活slide，不预加载
          slidesPerView={1}
          lazyPreloadPrevNext={0}
          // 滑动阻力配置
          resistance={true}
          resistanceRatio={0.85}
          // 滑动速度配置
          speed={300}
          // 触摸配置
          touchRatio={1}
          touchAngle={45}
          grabCursor={true}
        >
          {initialImages.map((image, index) => {
            // 只渲染当前slide和相邻的slide（上一个和下一个）
            // const shouldRender = Math.abs(index - activeIndex) <= 1

            // 1. 判断当前幻灯片是否是用户正在看的
            const isActive = index === activeIndex
            // 2. 判断当前幻灯片是否是需要预加载的（即下一个或上一个）
            const isPreloading = Math.abs(index - activeIndex) === 1
            // 3. 只有“活动”和“预加载”的幻灯片才会被渲染，其他都是占位符
            const shouldRender = isActive || isPreloading

            return (
              <SwiperSlide key={image.key} className=" flex w-full h-ful items-center justify-center overflow-hidden">
                <div className="relative w-full h-full bg-black">
                  {shouldRender ? (
                    <ImageSlide isActive={isActive} isPreloading={isPreloading} image={image} />
                  ) : (
                    <Placeholder.Image />
                  )}
                </div>
              </SwiperSlide>
            )
          })}

          {/* 如果还有更多数据，显示加载提示 */}
          {hasMore && (
            <SwiperSlide className="flex items-center justify-center text-white">
              <div className="text-center">
                {isLoading ? (
                  <div className="flex flex-col items-center space-y-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                    <p className="text-sm opacity-80">加载中...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center space-y-2">
                    <p className="text-sm opacity-80">继续向上滑动...</p>
                    <div className="animate-bounce">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 14l-7 7m0 0l-7-7m7 7V3"
                        />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            </SwiperSlide>
          )}

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
