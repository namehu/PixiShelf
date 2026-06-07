import { TArtworkTagDto } from '@/schemas/artwork.dto'
import { getTranslateName } from '@/utils/tags'
import { TagIcon } from 'lucide-react'
import Link from 'next/link'
import { FC, memo } from 'react'

interface TagAreaProps {
  tags?: TArtworkTagDto[]
}

const TagArea: FC<TagAreaProps> = ({ tags = [] }) => {
  return (
    <div className={`space-y-4 mt-6`}>
      <div className="flex items-center gap-2">
        <TagIcon />
        <h3 className="text-base sm:text-lg font-semibold text-gray-900">标签</h3>
      </div>
      <div className="flex flex-wrap gap-2 align-center max-w-full">
        {tags.map((tag) => {
          const cName = getTranslateName(tag)
          return (
            <Link href={`/tags/${tag.id}`} key={tag.id} className="inline-flex items-center  gap-2">
              <span className="rounded-full text-sm font-medium  text-blue-800 break-all cursor-pointer">
                #{tag.name}
              </span>
              {!!cName && <span className="text-xs text-gray-500 mx-0.5 cursor-pointer">{cName}</span>}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
export default memo(TagArea)
