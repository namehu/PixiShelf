import React, { useEffect } from 'react'
import { useInView } from 'react-intersection-observer'
import VideoPlayer from './VideoPlayer'

interface LazyVideoProps {
  src: string
  alt: string
  index: number
  onInView: (index: number, inView: boolean) => void
}

export function LazyVideo({ src, alt, index, onInView }: LazyVideoProps) {
  const { ref, inView } = useInView({
    threshold: 0.1,
    rootMargin: '200px 0px', // 预加载：提前200px开始加载
    triggerOnce: true
  })

  const { ref: viewRef, inView: isInViewport } = useInView({
    threshold: 0.5, // 当视频50%可见时认为是当前视频
    rootMargin: '0px'
  })

  useEffect(() => {
    onInView(index, isInViewport)
  }, [isInViewport, index, onInView])

  return (
    <div
      ref={(node) => {
        ref(node)
        viewRef(node)
      }}
      className="overflow-hidden bg-neutral-100 flex items-center justify-center"
    >
      {inView ? (
        <VideoPlayer
          src={src}
          alt={alt}
          controls={true}
          preload="metadata"
          className="w-full h-auto"
        />
      ) : (
        // 视频占位符
        <div className="w-full h-96 bg-neutral-200 animate-pulse flex items-center justify-center">
          <svg className="w-16 h-16 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}
    </div>
  )
}

export default LazyVideo