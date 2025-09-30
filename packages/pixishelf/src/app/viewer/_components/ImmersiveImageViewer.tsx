'use client'

import { Swiper, SwiperSlide } from 'swiper/react'
import { Mousewheel, Keyboard } from 'swiper/modules'
import ImageSlide from './ImageSlide'
import { useCallback, useState } from 'react'
import type { Swiper as SwiperType } from 'swiper'

// 导入 Swiper 的核心和模块样式
import 'swiper/css'
import 'swiper/css/mousewheel'
import 'swiper/css/keyboard'
import { RandomImageItem } from '@/types/images'

interface ImmersiveImageViewerProps {
  initialImages: RandomImageItem[]
  onLoadMore: () => void // 加载更多的回调函数
  hasMore: boolean
  isLoading: boolean
}

/**
 * 沉浸式图片浏览器组件
 * 使用Swiper实现垂直滑动切换，支持无限滚动加载
 */
export default function ImmersiveImageViewer({
  initialImages,
  onLoadMore,
  hasMore,
  isLoading
}: ImmersiveImageViewerProps) {
  const [activeIndex, setActiveIndex] = useState(0)

  // 处理滑动到底部的回调
  const handleReachEnd = useCallback(() => {
    if (hasMore && !isLoading) {
      onLoadMore()
    }
  }, [hasMore, isLoading, onLoadMore])

  // 处理slide变化
  const handleSlideChange = useCallback((swiper: SwiperType) => {
    setActiveIndex(swiper.activeIndex)
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
          // 关键事件：当滑动到最后一个 slide 时触发
          onReachEnd={handleReachEnd}
          // 处理slide变化
          onSlideChange={handleSlideChange}
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
            const shouldRender = Math.abs(index - activeIndex) <= 1

            return (
              <SwiperSlide key={image.key} className=" flex w-full h-ful items-center justify-center overflow-hidden">
                <div className="relative w-full h-full bg-black">
                  {shouldRender ? (
                    <ImageSlide image={image} />
                  ) : (
                    // 占位符，避免渲染实际的图片组件
                    <div className="w-full h-full flex items-center justify-center bg-neutral-900">
                      <div className="text-center text-white/20">
                        <div className="w-12 h-12 mx-auto mb-2 bg-white/5 rounded-lg flex items-center justify-center">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1}
                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 002 2v12a2 2 0 002 2z"
                            />
                          </svg>
                        </div>
                        <p className="text-xs">准备中...</p>
                      </div>
                    </div>
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
