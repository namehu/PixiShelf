'use client'

import { FileUp, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ImageManagerDragOverlayProps {
  dragZone: 'add' | 'replace' | null
}

export function ImageManagerDragOverlay({ dragZone }: ImageManagerDragOverlayProps) {
  return (
    <div className="absolute inset-0 z-50 flex pointer-events-none bg-background/50 backdrop-blur-[1px] animate-in fade-in duration-200">
      <div
        className={cn(
          'flex-1 flex flex-col items-center justify-center h-full border-r-2 border-dashed transition-colors duration-200',
          dragZone === 'add' ? 'border-primary/30 bg-primary/10' : 'border-muted-foreground/10 bg-transparent'
        )}
      >
        <div
          className={cn(
            'flex flex-col items-center transition-[opacity,transform] duration-200',
            dragZone === 'add' ? 'scale-110 opacity-100' : 'opacity-40 scale-90'
          )}
        >
          <Plus className="size-16 text-primary" strokeWidth={1.5} aria-hidden="true" />
          <div className="mt-4 text-lg font-medium text-primary">新增媒体</div>
        </div>
      </div>

      <div
        className={cn(
          'flex-1 flex flex-col items-center justify-center h-full transition-colors duration-200',
          dragZone === 'replace' ? 'bg-destructive/10' : 'bg-transparent'
        )}
      >
        <div
          className={cn(
            'flex flex-col items-center transition-[opacity,transform] duration-200',
            dragZone === 'replace' ? 'scale-110 opacity-100' : 'opacity-40 scale-90'
          )}
        >
          <FileUp className="size-16 text-destructive" strokeWidth={1.5} aria-hidden="true" />
          <div className="mt-4 text-lg font-medium text-destructive">全量替换</div>
        </div>
      </div>
    </div>
  )
}
