'use client'

import { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { ChevronLeftIcon, FullscreenIcon, ListOrdered } from 'lucide-react'
import MediaCounter from './media-counter'
import { useArtworkStore } from '@/store/use-artwork-store'
import { useEffect, useMemo, useState } from 'react'
import { getMediaInfo } from '@/lib/media'
import { useRouter } from 'next/navigation'
import { useSafeBack } from '@/hooks/use-safe-back'
import PageToolbar from '@/components/layout/page-toolbar'
import MediaOrderReviewDialog from './media-order-review-dialog'

export default function NavHead({ data, id }: { id: string; data: ArtworkResponseDto }) {
  const router = useRouter()
  const safeBack = useSafeBack('/artworks')
  const setImages = useArtworkStore((state) => state.setImages)
  const setTotal = useArtworkStore((state) => state.setTotal)
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const [orderReviewOpen, setOrderReviewOpen] = useState(false)

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
    <>
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
          <div className="flex items-center">
            {data.images.length > 1 && (
              <button
                type="button"
                onClick={() => setOrderReviewOpen(true)}
                className="flex size-11 items-center justify-center text-gray-600 transition-colors hover:text-gray-900 sm:size-12"
                aria-label="顺序校对"
                title="顺序校对"
              >
                <ListOrdered size={22} />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setImages(data.images)
                router.push('/artworks/preview')
              }}
              className="flex size-11 items-center justify-center text-gray-600 transition-colors hover:text-gray-900 sm:size-12"
              aria-label="全屏预览"
            >
              <FullscreenIcon size={22} className="text-gray-600" />
            </button>
          </div>
        }
      >
        <div className="flex justify-center">
          <MediaCounter hasVideo={isVideo} ext={ext} />
        </div>
      </PageToolbar>

      {orderReviewOpen && (
        <MediaOrderReviewDialog
          artworkId={data.id}
          images={data.images}
          onClose={() => setOrderReviewOpen(false)}
          onSaved={setImages}
        />
      )}
    </>
  )
}
