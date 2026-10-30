'use client'

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { HeartIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

export type LikePoint = { x: number; y: number }

export type FloatingLikeHeartsHandle = { show: (point: LikePoint) => void }

export function FloatingLikeHearts({ ref, className }: { ref: Ref<FloatingLikeHeartsHandle>; className?: string }) {
  const reducedMotion = useReducedMotion()
  const [hearts, setHearts] = useState<(LikePoint & { id: number })[]>([])
  const sequence = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useImperativeHandle(
    ref,
    () => ({
      show: (point) => {
        const id = ++sequence.current
        setHearts((items) => [...items, { ...point, id }])
        const timer = setTimeout(() => {
          timers.current.delete(timer)
          setHearts((items) => items.filter((heart) => heart.id !== id))
        }, 800)
        timers.current.add(timer)
      }
    }),
    []
  )
  useEffect(() => {
    const activeTimers = timers.current
    return () => {
      activeTimers.forEach(clearTimeout)
      activeTimers.clear()
    }
  }, [])
  return (
    <div
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      aria-hidden="true"
      data-floating-like-hearts
    >
      {hearts.map((heart) => (
        <motion.span
          key={heart.id}
          data-floating-like-heart
          data-reduced-motion={reducedMotion ? 'true' : 'false'}
          className="absolute text-[var(--media-like-color)] drop-shadow-md"
          style={{ left: heart.x, top: heart.y, marginLeft: -40, marginTop: -40 }}
          initial={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 0.35, rotate: -18, y: 0 }}
          animate={
            reducedMotion
              ? { opacity: [1, 1, 0] }
              : { opacity: [1, 1, 1, 0], scale: [0.35, 1.18, 1, 1], rotate: [-18, 8, -6, -6], y: [0, 0, -12, -80] }
          }
          transition={{ duration: 0.8, times: reducedMotion ? [0, 0.7, 1] : [0, 0.2, 0.4, 1], ease: 'easeOut' }}
        >
          <HeartIcon className="size-20 fill-current stroke-[1.5]" />
        </motion.span>
      ))}
    </div>
  )
}
