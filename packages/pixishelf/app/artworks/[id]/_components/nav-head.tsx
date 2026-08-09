'use client'

import { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { ChevronLeftIcon, FullscreenIcon } from 'lucide-react'
import MediaCounter from './media-counter'
import { useArtworkStore } from '@/store/useArtworkStore'
import { useEffect, useMemo } from 'react'
import { getMediaInfo } from '@/lib/media'
import { useRouter } from 'next/navigation'
import { useSafeBack } from '@/hooks/use-safe-back'
import PageToolbar from '@/components/layout/page-toolbar'

export default function NavHead({ data, id }: { id: string; data: ArtworkResponseDto }) {
  const router = useRouter()
  const safeBack = useSafeBack('/artworks')
  const setImages = useArtworkStore((state) => state.setImages)
  const setTotal = useArtworkStore((state) => state.setTotal)
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)

  // 2. 确保页面滚动顶部
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  // 1. 初始化数据到 Store
  useEffect(() => {
    if (data?.images) {
      setTotal(data.images.length)
      setCurrentIndex(0)
    }
  }, [data, setTotal, setCurrentIndex])

  const { ext, isVideo } = useMemo(() => getMediaInfo(data?.images?.[0]?.path || ''), [data])

  return (
    <PageToolbar
      leading={
        <button
          onClick={safeBack}
          className="flex w-16 items-center gap-2 text-gray-600 transition-colors hover:text-gray-900"
          aria-label="返回作品列表"
        >
          <ChevronLeftIcon size={24} />
          <span className="hidden sm:inline">返回</span>
        </button>
      }
      actions={
        <button
          onClick={() => {
            setImages(data.images)
            router.push('/artworks/preview')
          }}
          className="flex w-16 items-center justify-center text-gray-600 transition-colors hover:text-gray-900"
          aria-label="全屏预览"
        >
          <FullscreenIcon size={24} className="text-gray-600" />
        </button>
      }
    >
      <div className="flex justify-center">
        <MediaCounter hasVideo={isVideo} ext={ext} />
      </div>
    </PageToolbar>
  )
}
