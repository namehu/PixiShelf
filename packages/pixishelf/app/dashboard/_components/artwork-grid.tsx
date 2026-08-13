'use client'

import { ArtworkCardListResponse } from '@/types'
import ArtworkCard from '@/components/artwork/artwork-card'
import { useArtworkDisplayMode } from '@/components/user-setting'
import { PageState } from '@/components/layout/page-state'
import { cn } from '@/lib/utils'

interface ArtworkGridProps {
  initialData: ArtworkCardListResponse
}

/**
 * 作品网格客户端组件
 * 负责处理作品列表的动态渲染和状态管理
 */
export default function ArtworkGrid({ initialData }: ArtworkGridProps) {
  const displayMode = useArtworkDisplayMode()

  if (initialData?.items?.length) {
    return (
      <div
        className={cn(
          'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5',
          displayMode === 'minimal' ? 'gap-[2px]' : 'gap-4'
        )}
      >
        {initialData.items.map((artwork, index) => (
          <ArtworkCard key={artwork.id} artwork={artwork} priority={index < 4} displayMode={displayMode} />
        ))}
      </div>
    )
  }

  return (
    <PageState
      variant="empty"
      compact
      headingLevel="h3"
      title="暂无作品"
      description="完成首次导入后，最新作品会出现在这里。"
    />
  )
}
