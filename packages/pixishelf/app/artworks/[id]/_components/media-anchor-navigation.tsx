'use client'

import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpToLine, ChevronsDownUp, ChevronsUpDown, SlidersHorizontalIcon, StarIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ARTWORK_RATING_LABELS, type ArtworkRatingLevel } from '@/schemas/artwork-rating.dto'

function MediaAnchorList({
  indexes,
  activeIndex,
  onSelect,
  originalIndexes
}: {
  originalIndexes?: number[]
  indexes: number[]
  activeIndex: number
  onSelect: (index: number) => void
}) {
  const activeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeButtonRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  return (
    <nav aria-label="作品媒体快捷导航">
      <div className="flex flex-col gap-0.5">
        {indexes.map((index) => {
          const isActive = index === activeIndex
          return (
            <button
              key={index}
              ref={isActive ? activeButtonRef : undefined}
              type="button"
              aria-current={isActive ? 'true' : undefined}
              aria-label={`跳转到第 ${(originalIndexes?.[index] ?? index) + 1} 张媒体`}
              onClick={() => onSelect(index)}
              className={cn(
                'font-utility flex size-9 items-center justify-center rounded-full px-1 text-center text-xs tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-foreground/50',
                isActive
                  ? 'bg-primary-foreground font-semibold text-primary'
                  : 'text-primary-foreground/75 hover:bg-primary-foreground/15 hover:text-primary-foreground'
              )}
            >
              {(originalIndexes?.[index] ?? index) + 1}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export function MediaAnchorNavigation({
  indexes,
  activeIndex,
  currentIndex,
  total,
  open,
  onOpenChange,
  onSelect,
  collapsible,
  expanded,
  onToggleExpanded,
  onBackToTop,
  embedded = false,
  originalIndexes,
  originalTotal,
  onRate,
  ratingLevel = null,
  portaled = false
}: {
  indexes: number[]
  activeIndex: number
  currentIndex: number
  total: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (index: number) => void
  collapsible: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onBackToTop: () => void
  embedded?: boolean
  originalIndexes?: number[]
  originalTotal?: number
  onRate?: () => void
  ratingLevel?: ArtworkRatingLevel
  portaled?: boolean
}) {
  const dockRef = useRef<HTMLDivElement>(null)
  const openingRating = useRef(false)
  const reducedMotion = useReducedMotion()
  if (total <= 1 && !onRate) return null

  const sequenceIndex = Math.min(Math.max(currentIndex, 0), total - 1)
  const displayedIndex = (originalIndexes?.[sequenceIndex] ?? sequenceIndex) + 1
  const displayedTotal = originalTotal ?? total
  const counter = (
    <span className="font-utility flex flex-col items-center justify-center gap-0.5 text-[10px] leading-none tabular-nums">
      <span className="font-semibold">{displayedIndex}</span>
      <Separator className={cn('w-3', embedded ? 'bg-foreground/25' : 'bg-primary-foreground/35')} />
      <span className="font-normal opacity-70">{displayedTotal}</span>
    </span>
  )

  return (
    <div
      className={
        embedded || portaled ? '' : 'fixed right-4 bottom-[calc(var(--app-mobile-navigation-offset)+1rem)] z-40'
      }
    >
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={embedded ? 'ghost' : 'default'}
            size="icon"
            className={cn('size-11 rounded-full', !embedded && 'shadow-floating')}
            data-artwork-controls-trigger
            aria-label={
              total > 1
                ? `${open ? '关闭' : '打开'}媒体快捷导航，当前第 ${displayedIndex} 张，共 ${displayedTotal} 张`
                : `${open ? '关闭' : '打开'}作品快捷操作`
            }
            aria-expanded={open}
          >
            {total > 1 ? counter : <SlidersHorizontalIcon aria-hidden="true" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          ref={dockRef}
          tabIndex={-1}
          side="top"
          align="end"
          sideOffset={-44}
          avoidCollisions={false}
          onOpenAutoFocus={(event) => {
            openingRating.current = false
            // 聚焦容器而非首个功能按钮，避免刚展开就触发按钮的焦点 tooltip。
            event.preventDefault()
            dockRef.current?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(event) => {
            if (openingRating.current) event.preventDefault()
          }}
          aria-label="作品浏览控制"
          className="pointer-events-none relative flex min-h-24 w-[148px] origin-bottom-right justify-end border-0 bg-transparent p-0 pb-[52px] shadow-none motion-reduce:animate-none"
        >
          {onRate && (
            <motion.div
              className="pointer-events-auto absolute bottom-[90px] right-[52px]"
              initial={reducedMotion ? false : { opacity: 0, x: 52, y: 90, scale: 0.72 }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              transition={{
                duration: reducedMotion ? 0 : 0.24,
                delay: reducedMotion ? 0 : 0.04,
                ease: [0.22, 1, 0.36, 1]
              }}
            >
              <Tooltip delayDuration={350}>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    className="size-11 rounded-full shadow-floating"
                    data-rating={ratingLevel ?? 0}
                    aria-label={`评分：${ratingLevel === null ? '未评分' : ARTWORK_RATING_LABELS[ratingLevel]}`}
                    onClick={() => {
                      openingRating.current = true
                      onOpenChange(false)
                      onRate()
                    }}
                  >
                    <StarIcon aria-hidden="true" fill={ratingLevel === null ? 'none' : 'currentColor'} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {ratingLevel === null ? '为作品评分' : ARTWORK_RATING_LABELS[ratingLevel]}
                </TooltipContent>
              </Tooltip>
            </motion.div>
          )}
          {/* 弹层底边与 44px 主按钮底边重合；预留 52px，让页码与主按钮保持 8px 间隔。 */}
          <motion.div
            className="pointer-events-auto absolute bottom-0 right-[104px]"
            initial={reducedMotion ? false : { opacity: 0, x: 104, y: 0, scale: 0.72 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <Tooltip delayDuration={350}>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  className="size-11 rounded-full shadow-floating"
                  aria-label="回到顶部"
                  onClick={() => {
                    onOpenChange(false)
                    onBackToTop()
                  }}
                >
                  <ArrowUpToLine className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">回到顶部</TooltipContent>
            </Tooltip>
          </motion.div>
          {collapsible && (
            <motion.div
              className="pointer-events-auto absolute bottom-[52px] right-[90px]"
              initial={reducedMotion ? false : { opacity: 0, x: 90, y: 52, scale: 0.72 }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              transition={{
                duration: reducedMotion ? 0 : 0.24,
                delay: reducedMotion ? 0 : 0.02,
                ease: [0.22, 1, 0.36, 1]
              }}
            >
              <Tooltip delayDuration={350}>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    className="size-11 rounded-full shadow-floating"
                    aria-label={expanded ? '收起媒体列表' : '展开全部媒体'}
                    onClick={() => {
                      onOpenChange(false)
                      onToggleExpanded()
                    }}
                  >
                    {expanded ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{expanded ? '收起媒体列表' : '展开全部媒体'}</TooltipContent>
              </Tooltip>
            </motion.div>
          )}
          {indexes.length > 0 ? (
            <div
              data-testid="media-anchor-popover"
              className="pointer-events-auto max-h-[min(70dvh,calc(var(--radix-popover-content-available-height)-52px))] w-11 overflow-y-auto overscroll-contain rounded-full border border-primary/20 bg-primary p-1 text-primary-foreground shadow-floating"
            >
              <MediaAnchorList
                originalIndexes={originalIndexes}
                indexes={indexes}
                activeIndex={activeIndex}
                onSelect={onSelect}
              />
            </div>
          ) : (
            <div className="h-11" />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
