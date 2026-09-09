'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  PauseIcon,
  PlayIcon,
  Settings2Icon,
  XIcon,
  RotateCcwIcon,
  ChevronRightIcon,
  LoaderCircleIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { useArtworkAutoBrowseStore, type AutoBrowseMode } from '@/store/use-artwork-auto-browse-store'

interface AutoBrowseControlsProps {
  mode: AutoBrowseMode
  current: number
  total: number
  navigation?: ReactNode
  onRestart: () => void
  onRetry: () => void
  onSkip: () => void
  onExit?: () => void
  blocked?: boolean
  container?: HTMLElement | null
}

export function AutoBrowseControls({
  mode,
  current,
  total,
  navigation,
  onRestart,
  onRetry,
  onSkip,
  onExit,
  blocked,
  container
}: AutoBrowseControlsProps) {
  const state = useArtworkAutoBrowseStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [waitingWhenOpened, setWaitingWhenOpened] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const selected = state.mode === mode
  const playing = selected && (state.status === 'running' || state.status === 'waiting')
  const ended = selected && state.status === 'ended'
  const error = selected && state.reason === 'error'
  const collapsed = playing && state.controlsCollapsed && !settingsOpen
  const needsAttention = error || blocked || (selected && (state.reason === 'video' || ended))
  useEffect(() => {
    const root = rootRef.current
    if (!root || !playing || collapsed || settingsOpen) return
    let timer: ReturnType<typeof setTimeout>
    let keyboardInput = false
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        // Keep keyboard controls available while focus is visibly inside the toolbar.
        if (
          (keyboardInput && root.contains(document.activeElement)) ||
          root.querySelector(':focus-visible') ||
          root.querySelector(':active')
        ) {
          schedule()
        } else useArtworkAutoBrowseStore.getState().setControlsCollapsed(true)
      }, 4000)
    }
    const keyboard = () => {
      keyboardInput = true
    }
    const pointer = () => {
      keyboardInput = false
    }
    schedule()
    document.addEventListener('keydown', keyboard, true)
    document.addEventListener('pointerdown', pointer, true)
    root.addEventListener('pointermove', schedule)
    root.addEventListener('pointerdown', schedule)
    root.addEventListener('focusin', schedule)
    root.addEventListener('keydown', schedule)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', keyboard, true)
      document.removeEventListener('pointerdown', pointer, true)
      root.removeEventListener('pointermove', schedule)
      root.removeEventListener('pointerdown', schedule)
      root.removeEventListener('focusin', schedule)
      root.removeEventListener('keydown', schedule)
    }
  }, [playing, collapsed, settingsOpen])
  const value = mode === 'scroll' ? state.scrollSpeed : state.slideSeconds
  const presets = mode === 'scroll' ? [50, 100, 200] : [3, 1.5, 0.5]
  const setValue = (next: number) =>
    state.setPreferences(mode === 'scroll' ? { scrollSpeed: next } : { slideSeconds: next })
  const description = !selected
    ? '自动轮播'
    : state.status === 'waiting'
      ? '等待图片加载'
      : error
        ? '图片加载失败'
        : state.reason === 'video'
          ? '视频已暂停自动滚动'
          : blocked
            ? '缩小图片后继续'
            : ended
              ? '已结束'
              : mode === 'scroll'
                ? '自动滚动'
                : '自动轮播'

  return (
    <motion.div
      ref={rootRef}
      layout={reducedMotion ? false : 'size'}
      style={{ originX: 1, originY: 1 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      data-auto-browse-controls
      data-auto-browse-mode={mode}
      data-collapsed={collapsed}
      className="pointer-events-auto flex max-w-[calc(100vw-2rem)] flex-col rounded-3xl border border-border/40 bg-background/55 p-0.5 text-foreground shadow-sm backdrop-blur-md"
    >
      {collapsed ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-11 flex-col gap-0 rounded-full"
          aria-label={`展开自动浏览控制，当前第 ${current} 张，共 ${total} 张`}
          aria-expanded={false}
          title="展开自动浏览控制"
          onClick={() => {
            state.setControlsCollapsed(false)
            requestAnimationFrame(() => rootRef.current?.querySelector('button')?.focus({ preventScroll: true }))
          }}
        >
          {state.status === 'waiting' ? <LoaderCircleIcon className="motion-safe:animate-spin" /> : <PlayIcon />}
          <span className="text-[10px] leading-3 tabular-nums">
            {current}/{total}
          </span>
        </Button>
      ) : (
        <>
          <div className="flex items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-11 rounded-full"
              disabled={blocked || (error && !playing)}
              aria-label={playing ? '暂停自动浏览' : ended ? '重新开始自动浏览' : '开始或继续自动浏览'}
              title={playing ? '暂停' : ended ? '重新开始' : selected ? '继续' : '自动轮播'}
              onClick={() => {
                if (playing) state.pause()
                else if (ended) onRestart()
                else if (selected) state.resume()
                else state.start(mode)
              }}
            >
              {playing && state.status === 'waiting' ? (
                <LoaderCircleIcon className="motion-safe:animate-spin" />
              ) : playing ? (
                <PauseIcon data-icon="inline-start" />
              ) : ended ? (
                <RotateCcwIcon data-icon="inline-start" />
              ) : (
                <PlayIcon data-icon="inline-start" />
              )}
            </Button>
            {navigation ?? (
              <span className="px-2 text-sm tabular-nums" aria-label={`当前第 ${current} 张，共 ${total} 张`}>
                {current} / {total}
              </span>
            )}
            <Popover
              open={settingsOpen}
              onOpenChange={(open) => {
                setWaitingWhenOpened(open && state.status === 'waiting')
                if (open) state.pause('overlay')
                setSettingsOpen(open)
              }}
            >
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="size-11" aria-label="自动浏览设置">
                  <Settings2Icon />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                container={container}
                side="top"
                align="center"
                data-auto-browse-controls
                data-auto-browse-settings
              >
                {selected && waitingWhenOpened && (
                  <div className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
                    <span>等待图片加载</span>
                    <Button variant="ghost" className="min-h-11" onClick={onRetry}>
                      重试
                    </Button>
                    <Button variant="ghost" className="min-h-11" onClick={onSkip}>
                      跳过
                    </Button>
                  </div>
                )}
                <FieldGroup>
                  <Field>
                    <FieldLabel>
                      {mode === 'scroll' ? `滚动速度：${value} 像素/秒` : `每张停留：${value} 秒`}
                    </FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={presets.includes(value) ? String(value) : ''}
                      onValueChange={(next) => {
                        if (next) setValue(Number(next))
                      }}
                      aria-label="浏览速度档位"
                    >
                      {presets.map((preset, index) => (
                        <ToggleGroupItem key={preset} value={String(preset)} className="min-h-11">
                          {['慢', '中', '快'][index]}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <Slider
                      aria-label={mode === 'scroll' ? '滚动速度' : '每张停留秒数'}
                      value={[value]}
                      min={mode === 'scroll' ? 50 : 0.5}
                      max={mode === 'scroll' ? 800 : 3}
                      step={mode === 'scroll' ? 50 : 0.5}
                      onValueChange={([next]) => {
                        if (next !== undefined) setValue(next)
                      }}
                    />
                  </Field>
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor={`auto-browse-loop-${mode}`}>循环当前作品</FieldLabel>
                    <Switch
                      id={`auto-browse-loop-${mode}`}
                      checked={state.loop}
                      onCheckedChange={(loop) => state.setPreferences({ loop })}
                    />
                  </Field>
                </FieldGroup>
              </PopoverContent>
            </Popover>
            {onExit && (
              <Button variant="ghost" size="icon" className="size-11" aria-label="退出自动浏览" onClick={onExit}>
                <XIcon />
              </Button>
            )}
            {playing && (
              <Button
                variant="ghost"
                size="icon"
                className="size-11 rounded-full"
                aria-label="收起自动浏览控制"
                onClick={() => state.setControlsCollapsed(true)}
              >
                <ChevronRightIcon />
              </Button>
            )}
          </div>
          <span role="status" className="sr-only">
            {description}
          </span>
          {needsAttention && (
            <div className="flex items-center justify-center gap-1 px-2 pb-1 text-xs text-muted-foreground">
              <span>{description}</span>
              {error && (
                <>
                  <Button variant="ghost" className="min-h-11" onClick={onRetry}>
                    重试
                  </Button>
                  <Button variant="ghost" className="min-h-11" onClick={onSkip}>
                    跳过
                  </Button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}
