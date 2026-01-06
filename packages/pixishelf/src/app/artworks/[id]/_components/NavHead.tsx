'use client'

import { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { ChevronLeftIcon, FullscreenIcon } from 'lucide-react'
import MediaCounter from './MediaCounter'
import { useArtworkStore } from '@/store/useArtworkStore'
import { useEffect, useMemo } from 'react'
import { getMediaInfo } from '../../../../../lib/media'
import { useRouter } from 'next/navigation'

export default function NavHead({ data, id }: { id: string; data: ArtworkResponseDto }) {
  const router = useRouter()
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
    <div className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <button
            onClick={() => router.back()}
            className="w-16 flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ChevronLeftIcon size={24} />
            <span className="hidden sm:inline">返回</span>
          </button>

          <MediaCounter hasVideo={isVideo} ext={ext} />

          <button
            onClick={() => {
              setImages(data.images)
              router.push('/artworks/preview')
            }}
            className="w-16 flex items-center justify-center text-gray-600 hover:text-gray-900 transition-colors"
          >
            <FullscreenIcon size={24} className="text-gray-600" />
          </button>
        </div>
      </div>
    </div>
  )
}
