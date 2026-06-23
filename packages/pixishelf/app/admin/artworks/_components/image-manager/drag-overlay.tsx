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
          dragZone === 'add' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-transparent border-muted-foreground/10'
        )}
      >
        <div
          className={cn(
            'flex flex-col items-center transition-all duration-200',
            dragZone === 'add' ? 'scale-110 opacity-100' : 'opacity-40 scale-90'
          )}
        >
          <Plus className="w-16 h-16 text-blue-500" strokeWidth={1.5} />
          <div className="mt-4 text-lg font-medium text-blue-500">新增媒体</div>
        </div>
      </div>

      <div
        className={cn(
          'flex-1 flex flex-col items-center justify-center h-full transition-colors duration-200',
          dragZone === 'replace' ? 'bg-red-500/10' : 'bg-transparent'
        )}
      >
        <div
          className={cn(
            'flex flex-col items-center transition-all duration-200',
            dragZone === 'replace' ? 'scale-110 opacity-100' : 'opacity-40 scale-90'
          )}
        >
          <FileUp className="w-16 h-16 text-red-500" strokeWidth={1.5} />
          <div className="mt-4 text-lg font-medium text-red-500">全量替换</div>
        </div>
      </div>
    </div>
  )
}
