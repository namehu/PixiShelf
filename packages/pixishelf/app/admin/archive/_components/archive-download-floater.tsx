'use client'

import { useState, type ComponentProps, type CSSProperties } from 'react'
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ActiveArchiveDownloadPanel } from './archive-active-download-panel'

export function ArchiveDownloadFloater({
  bottomOffset = 0,
  ...props
}: ComponentProps<typeof ActiveArchiveDownloadPanel> & { bottomOffset?: number }) {
  const [open, setOpen] = useState(false)
  const { task } = props
  const completed = task.liveTransfer?.completedItems ?? task.completedItems
  const total = task.liveTransfer?.totalItems ?? task.totalItems
  const progress = total > 0 ? Math.round((completed / total) * 100) : task.progress
  const label =
    task.systemJobStatus === 'PAUSING' ? '正在暂停' : task.systemJobStatus === 'CANCELLING' ? '正在取消' : '当前下载'

  return (
    <div
      className="fixed right-4 bottom-[calc(var(--app-mobile-navigation-offset)+var(--archive-download-bottom-offset)+1rem)] z-30 lg:right-6 lg:bottom-[calc(var(--archive-download-bottom-offset)+1.5rem)]"
      style={{ '--archive-download-bottom-offset': `${bottomOffset}px` } as CSSProperties}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            className="size-16 flex-col gap-0.5 rounded-full p-0 shadow-floating"
            aria-label={`${label} ${progress}%，点击${open ? '收起' : '展开'}`}
          >
            <Download data-icon="inline-start" aria-hidden="true" />
            <span className="text-xs tabular-nums">{progress}%</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={12}
          collisionPadding={16}
          aria-label="当前下载详情"
          className="max-h-[min(38rem,var(--radix-popover-content-available-height))] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto p-0"
        >
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-sm font-medium">下载详情</h2>
            <Button variant="ghost" size="icon" aria-label="收起当前下载" onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </Button>
          </div>
          <ActiveArchiveDownloadPanel
            {...props}
            onViewItems={() => {
              setOpen(false)
              props.onViewItems()
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
