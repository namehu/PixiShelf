import { Tag } from '@/types'
import { getTranslateName } from '@/utils/tags'
import { TagIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, memo } from 'react'

interface TagAreaProps {
  tags?: Tag[]
  className?: string
}

const TagArea: FC<TagAreaProps> = ({ tags = [], className = '' }) => {
  const router = useRouter()

  const handleTagClick = (tag: Tag) => {
    router.push(`/tags/${tag.id}`)
  }
  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center gap-2">
        <TagIcon></TagIcon>
        <h3 className="text-base sm:text-lg font-semibold text-gray-900">标签</h3>
      </div>
      <div className="flex flex-wrap gap-2 align-center max-w-full">
        {tags.map((tag) => {
          const cName = getTranslateName(tag)
          return (
            <div key={tag.id} className="inline-flex items-center  gap-2" onClick={() => handleTagClick(tag)}>
              <span className="rounded-full text-sm font-medium  text-blue-800 break-all cursor-pointer">
                #{tag.name}
              </span>
              {!!cName && <span className="text-xs text-gray-500 mx-0.5 cursor-pointer">{cName}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
export default memo(TagArea)
