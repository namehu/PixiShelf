'use client'

import { RefreshCw } from 'lucide-react'
import { Label } from '@/components/ui/label'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { RecentTagsList } from './recent-tags-list'

interface ImageManagerTagPanelProps {
  isSavingTags: boolean
  selectedTagOptions: Option[]
  onSearchTag: (value: string) => Promise<Option[]>
  onTagsChange: (options: Option[]) => void
}

export function ImageManagerTagPanel({
  isSavingTags,
  selectedTagOptions,
  onSearchTag,
  onTagsChange
}: ImageManagerTagPanelProps) {
  return (
    <div className="space-y-2 px-1 shrink-0 pt-2">
      <div className="flex items-center justify-between">
        <Label>快捷标签</Label>
        {isSavingTags && (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            保存中
          </span>
        )}
      </div>
      <MultipleSelector
        placeholder="搜索并添加标签..."
        defaultOptions={selectedTagOptions}
        value={selectedTagOptions}
        onSearch={onSearchTag}
        onChange={onTagsChange}
        triggerSearchOnFocus
      />
      <RecentTagsList
        selectedValues={selectedTagOptions.map((t) => t.value)}
        onSelect={(tag) => {
          const exists = selectedTagOptions.some((t) => t.value === tag.value)
          if (exists) return
          onTagsChange([...selectedTagOptions, { value: tag.value, label: tag.label }])
        }}
      />
    </div>
  )
}
