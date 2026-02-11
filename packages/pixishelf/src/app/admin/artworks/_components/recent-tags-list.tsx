'use client'

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'
import { useRecentTags, TagOption } from '@/store/admin/useRecentTags'

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
          <Badge
            key={tag.value}
            variant={isSelected ? 'outline' : 'secondary'}
            className={`cursor-pointer pr-1 flex items-center gap-1 group relative ${
              isSelected ? 'opacity-50 cursor-not-allowed' : 'hover:bg-secondary/80'
            }`}
            onClick={() => {
              if (!isSelected) {
                onSelect(tag)
                addTag(tag) // 点击也视为使用，更新时间戳
              }
            }}
          >
            {tag.label}
            <div
              role="button"
              className="hover:bg-destructive/20 rounded-full p-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-[2000ms]"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(tag.value)
              }}
            >
              <X size={10} />
            </div>
          </Badge>
        )
      })}
    </div>
  )
}
