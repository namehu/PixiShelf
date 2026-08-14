'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { useRecentTags, TagOption } from '@/store/admin/use-recent-tags'
import { cn } from '@/lib/utils'

interface RecentTagsListProps {
  /** 当前已选中的标签值列表，用于去重判断 */
  selectedValues: string[]
  /** 选中标签的回调 */
  onSelect: (tag: TagOption) => void
  /** 最大显示数量，默认为 10 */
  limit?: number
}

export function RecentTagsList({ selectedValues, onSelect, limit = 10 }: RecentTagsListProps) {
  const { tags: recentTags, addTag, removeTag } = useRecentTags()

  if (recentTags.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2 pt-2">
      <span className="text-xs text-muted-foreground self-center">常用:</span>
      {recentTags.slice(0, limit).map((tag) => {
        const isSelected = selectedValues.includes(tag.value)
        return (
          <div key={tag.value} className="group inline-flex items-center rounded-full bg-secondary text-secondary-foreground">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn('h-6 rounded-full px-2 text-xs hover:bg-secondary/80', isSelected && 'opacity-50')}
              disabled={isSelected}
              onClick={() => {
                onSelect(tag)
                addTag(tag) // 点击也视为使用，更新时间戳
              }}
            >
              {tag.label}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mr-0.5 size-5 rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
              aria-label={`从常用标签中移除 ${tag.label}`}
              onClick={() => {
                removeTag(tag.value)
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
