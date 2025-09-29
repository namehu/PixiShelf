'use client'

import { Swiper, SwiperSlide } from 'swiper/react'
import { Mousewheel, Keyboard } from 'swiper/modules'
import ImageSlide from './ImageSlide'
import { useCallback } from 'react'

// 导入 Swiper 的核心和模块样式
import 'swiper/css'
import 'swiper/css/mousewheel'
import 'swiper/css/keyboard'
import { RandomImageItem } from '@/types/images'
import ImageOverlay from './ImageOverlay'

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
  // 处理滑动到底部的回调
  const handleReachEnd = useCallback(() => {
    if (hasMore && !isLoading) {
      onLoadMore()
    }
  }, [hasMore, isLoading, onLoadMore])

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
          // 为了更好的性能，只渲染激活slide的前后各一个
          slidesPerView={1}
          lazyPreloadPrevNext={1}
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
          {initialImages.map((image) => (
            <SwiperSlide
              key={image.key}
              className="relative flex w-full h-ful items-center justify-center overflow-hidden"
            >
              <ImageOverlay image={image} />
              <div className="relative w-full h-full bg-black">
                <ImageSlide image={image} />
              </div>
            </SwiperSlide>
          ))}

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
