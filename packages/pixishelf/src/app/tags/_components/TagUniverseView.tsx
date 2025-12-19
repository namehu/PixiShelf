import React from 'react'
import { Marquee } from './Marquee'
import { TagItem } from './TagItem'
import { Tag } from '@/types'

interface TagUniverseViewProps {
  tags: Tag[]
  onTagClick: (tag: Tag) => void
}

export const TagUniverseView: React.FC<TagUniverseViewProps> = ({ tags, onTagClick }) => {
  const rows = React.useMemo(() => {
    const rowCount = 8
    const chunked: Tag[][] = Array.from({ length: rowCount }, () => [])
    tags.forEach((tag, i) => {
      chunked[i % rowCount]!.push(tag)
    })
    return chunked
  }, [tags])

  return (
    <div className="relative w-full h-[65vh] md:h-[70vh] flex flex-col justify-center gap-4 md:gap-6 py-8 overflow-hidden bg-transparent">
      {/* 核心流动区域 */}
      {rows.map((rowTags, idx) => (
        <Marquee
          key={idx}
          direction={idx % 2 === 0 ? 'left' : 'right'}
          speed={50 + ((idx * 15) % 100)}
          className="py-1"
        >
          {rowTags.map((tag) => (
            <TagItem key={tag.id} tag={tag} onClick={onTagClick} size={idx % 4 === 0 ? 'lg' : 'md'} />
          ))}
        </Marquee>
      ))}

      {/* 精细化侧边遮罩：移动端更窄，防止遮挡 */}
      <div className="absolute inset-y-0 left-0 w-12 md:w-32 bg-gradient-to-r from-[#f8fafc] to-transparent pointer-events-none z-10" />
      <div className="absolute inset-y-0 right-0 w-12 md:w-32 bg-gradient-to-l from-[#f8fafc] to-transparent pointer-events-none z-10" />
    </div>
  )
}
