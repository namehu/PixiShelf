import React from 'react'
import { motion } from 'framer-motion'
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

  React.useEffect(() => {
    if (containerRef.current) {
      setContentWidth(containerRef.current.scrollWidth / 2)
    }
  }, [children])

  return (
    <div className={cn('overflow-hidden whitespace-nowrap flex group', className)}>
      <motion.div
        ref={containerRef}
        className="flex shrink-0 min-w-full"
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
