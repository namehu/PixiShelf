'use client'

import { LayoutGrid, List as ListIcon, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatFileSize } from '@/utils/media'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

interface ImageManagerToolbarProps {
  showThumbnails: boolean
  onShowThumbnailsChange: (showThumbnails: boolean) => void
  onRefresh: () => void
  onAdd: () => void
  onReplace: () => void
  firstImagePath: string | null
  mediaCount: number
  totalSize: number
  selectedVideoCount: number
  isSubmittingKeyframes: boolean
  onGenerateSelectedKeyframes: () => void
}

export function ImageManagerToolbar({
  showThumbnails,
  onShowThumbnailsChange,
  onRefresh,
  onAdd,
  onReplace,
  firstImagePath,
  mediaCount,
  totalSize,
  selectedVideoCount,
  isSubmittingKeyframes,
  onGenerateSelectedKeyframes
}: ImageManagerToolbarProps) {
  return (
    <div className="flex justify-between items-center px-1 shrink-0">
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-muted p-1 rounded-md">
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-7 w-7', !showThumbnails && 'bg-background shadow-sm')}
            onClick={() => onShowThumbnailsChange(false)}
            title="列表视图"
          >
            <ListIcon className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-7 w-7', showThumbnails && 'bg-background shadow-sm')}
            onClick={() => onShowThumbnailsChange(true)}
            title="缩略图视图"
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} className="h-8">
          <RefreshCw className="w-3.5 h-3.5 mr-2" />
          刷新缓存
        </Button>

        <Button variant="outline" size="sm" onClick={onAdd} className="h-8">
          <Plus className="w-3.5 h-3.5 mr-2" />
          新增媒体
        </Button>

        <Button variant="destructive" size="sm" onClick={onReplace}>
          全量替换
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={selectedVideoCount === 0 || isSubmittingKeyframes}
          onClick={onGenerateSelectedKeyframes}
        >
          <Sparkles className="mr-1.5 size-4" />
          为已选视频生成代表帧{selectedVideoCount > 0 ? ` (${selectedVideoCount})` : ''}
        </Button>
      </div>
      {mediaCount > 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-3">
          <PrivacySensitiveText className="font-mono">
            {firstImagePath ? `...${firstImagePath.slice(-20)}` : ''}
          </PrivacySensitiveText>
          <span>{mediaCount} 个媒体</span>
          <span>•</span>
          <span>共: {formatFileSize(totalSize)}</span>
        </div>
      )}
    </div>
  )
}
