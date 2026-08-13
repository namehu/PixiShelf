'use client'

import { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { ChevronLeftIcon, FullscreenIcon, ListOrdered, Settings2 } from 'lucide-react'
import MediaCounter from './media-counter'
import { useArtworkStore } from '@/store/use-artwork-store'
import { useEffect, useMemo, useState } from 'react'
import { getMediaInfo } from '@/lib/media'
import { useRouter } from 'next/navigation'
import { useSafeBack } from '@/hooks/use-safe-back'
import PageToolbar from '@/components/layout/page-toolbar'
import MediaOrderReviewDialog from './media-order-review-dialog'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

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
        containerSize="reading"
        leading={
          <Button variant="ghost" size="sm" onClick={safeBack} aria-label="返回作品列表" className="-ml-2 min-h-11">
            <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
            <span className="hidden sm:inline">返回</span>
          </Button>
        }
        actions={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" asChild className="size-11">
              <Link
                href={{
                  pathname: '/admin/artworks',
                  query: {
                    id: data.id,
                    edit: data.id,
                    tab: 'media',
                    returnTo: `/artworks/${data.id}`
                  }
                }}
                aria-label="管理当前作品"
                title="管理当前作品"
              >
                <Settings2 aria-hidden="true" />
              </Link>
            </Button>
            {data.images.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOrderReviewOpen(true)}
                className="size-11"
                aria-label="顺序校对"
                title="顺序校对"
              >
                <ListOrdered aria-hidden="true" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setImages(data.images)
                router.push('/artworks/preview')
              }}
              className="size-11"
              aria-label="全屏预览"
            >
              <FullscreenIcon aria-hidden="true" />
            </Button>
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
