import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface MarqueeProps {
  children: React.ReactNode
  direction?: 'left' | 'right'
  speed?: number
  className?: string
  pauseOnHover?: boolean
}

export const Marquee: React.FC<MarqueeProps> = ({
  children,
  direction = 'left',
  speed = 40,
  className,
  pauseOnHover = true
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = React.useState(0)
  const shouldReduceMotion = useReducedMotion()

  React.useEffect(() => {
    if (containerRef.current) {
      setContentWidth(containerRef.current.scrollWidth / 2)
    }
  }, [children])

  if (shouldReduceMotion) {
    return <div className={cn('flex flex-wrap gap-4 px-2 py-1', className)}>{children}</div>
  }

  return (
    <div className={cn('group flex overflow-hidden whitespace-nowrap', className)}>
      <motion.div
        ref={containerRef}
        className="flex min-w-full shrink-0"
        animate={{
          x: direction === 'left' ? [-contentWidth, 0] : [0, -contentWidth]
        }}
        transition={{
          duration: speed,
          repeat: Infinity,
          ease: 'linear'
        }}
        whileHover={pauseOnHover ? { animationPlayState: 'paused' } : undefined}
        style={{
          width: 'max-content'
        }}
      >
        <div className="flex gap-4 px-2">{children}</div>
        <div className="flex gap-4 px-2">{children}</div>
      </motion.div>
    </div>
  )
}
