'use client'

import Image, { ImageProps } from 'next/image'
import { useState, useRef, useEffect } from 'react'
import loader from '../../../lib/image-loader'
import { ImageIcon } from 'lucide-react'

interface MyImageLoaderProps extends Omit<ImageProps, 'loader'> {
  enableIntersectionObserver?: boolean
}

export default function ClientImage({ enableIntersectionObserver = true, ...props }: MyImageLoaderProps) {
  const { src } = props
  const [shouldLoad, setShouldLoad] = useState(!enableIntersectionObserver)
  const imgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enableIntersectionObserver || shouldLoad) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true)
            observer.unobserve(entry.target)
          }
        })
      },
      {
        rootMargin: '100px', // 提前100px开始加载
        threshold: 0.1
      }
    )

    if (imgRef.current) {
      observer.observe(imgRef.current)
    }

    return () => {
      observer.disconnect()
    }
  }, [enableIntersectionObserver, shouldLoad])

  return (
    <div ref={imgRef} className="h-full w-full">
      {shouldLoad && !!src ? (
        <Image {...props} loader={loader as any} loading="lazy" />
      ) : (
        <div className="h-full w-full bg-gray-200 flex items-center justify-center animate-pulse">
          <ImageIcon size={24} className="text-gray-400"></ImageIcon>
        </div>
      )}
    </div>
  )
}
