import React from 'react'
import { Marquee } from './marquee'
import { TagItem } from './tag-item'
import { Tag } from '@/types'

interface TagUniverseViewProps {
  tags: Tag[]
}

export const TagUniverseView: React.FC<TagUniverseViewProps> = ({ tags }) => {
  const rows = React.useMemo(() => {
    const rowCount = 8
    const chunked: Tag[][] = Array.from({ length: rowCount }, () => [])

    // 标签按 ID 去重。
    const uniqueTags = Array.from(new Map(tags.map((tag) => [tag.id, tag])).values()).slice(0, 100)

    uniqueTags.forEach((tag, i) => {
      chunked[i % rowCount]!.push(tag)
    })
    return chunked
  }, [tags])

  return (
    <div className="relative flex size-full flex-col justify-center overflow-hidden bg-transparent py-4">
      {/* 核心流动区域 */}
      {rows.map((rowTags, idx) => (
        <Marquee
          key={idx}
          direction={idx % 2 === 0 ? 'left' : 'right'}
          speed={50 + ((idx * 15) % 100)}
          className="py-1"
        >
          {rowTags.map((tag) => (
            <TagItem key={tag.id} tag={tag} size="md" />
          ))}
        </Marquee>
      ))}

      {/* 精细化侧边遮罩：移动端更窄，防止遮挡 */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-background to-transparent md:w-32" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background to-transparent md:w-32" />
    </div>
  )
}
