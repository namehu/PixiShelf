'use client'

import { Loader2 } from 'lucide-react'
import Image from 'next/image'
import { useInView } from 'react-intersection-observer'
import { cn } from '@/lib/utils'

export const LazyImage = ({ src, alt, className, ...props }: any) => {
  const { ref, inView } = useInView({
    triggerOnce: true,
    rootMargin: '100px 0px', // Preload when close
    threshold: 0.1
  })

  return (
    <div ref={ref} className={cn('relative w-full h-full bg-muted/30', className)}>
      {inView ? (
        <Image
          src={src}
          alt={alt}
          className={cn('transition-opacity duration-300', className)}
          loading="lazy"
          {...props}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/20">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}
    </div>
  )
}
