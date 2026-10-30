'use client'

import { useId, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { GripVerticalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { usePreviewControlsDock } from './use-preview-controls-dock'

export function DockablePreviewControls({
  dock,
  children
}: {
  dock: ReturnType<typeof usePreviewControlsDock>
  children: ReactNode
}) {
  const descriptionId = useId()
  return (
    <div ref={dock.stageRef} className="preview-controls-stage pointer-events-none absolute inset-0 z-20">
      <motion.div
        ref={dock.controlsRef}
        data-preview-controls-dock={dock.dock}
        data-dragging={dock.dragging}
        data-orientation={dock.orientation}
        className={cn(
          'preview-dock-controls pointer-events-auto absolute left-0 top-0 flex w-max max-w-full items-center gap-1',
          dock.orientation === 'vertical' && 'flex-col overflow-y-auto'
        )}
        style={{ x: dock.x, y: dock.y }}
      >
        <Button
          {...dock.handleProps}
          type="button"
          variant="secondary"
          aria-label="拖动阅读工具栏"
          aria-describedby={descriptionId}
          title="拖动工具栏：底部、左侧或右侧"
        className="media-mark-overlay size-11 shrink-0 touch-none rounded-full p-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:size-12 [&_svg]:size-6"
        style={{ outlineOffset: -3 }}
        >
          <GripVerticalIcon aria-hidden="true" />
        </Button>
        <span id={descriptionId} className="sr-only">
          拖动后吸附到最近一侧；左、右方向键停靠两侧，向下或 Home 回到底部，Escape 取消拖动。
        </span>
        {children}
      </motion.div>
    </div>
  )
}
