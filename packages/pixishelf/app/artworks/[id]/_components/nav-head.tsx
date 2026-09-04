'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ChevronLeftIcon, EllipsisIcon, FullscreenIcon, ListOrderedIcon, Settings2Icon } from 'lucide-react'
import { useSafeBack } from '@/hooks/use-safe-back'
import { useMediaQuery } from '@/hooks/use-media-query'
import PageToolbar from '@/components/layout/page-toolbar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { useArtworkStore } from '@/store/use-artwork-store'
import MediaOrderReviewDialog from './media-order-review-dialog'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

export default function NavHead({ data, id }: { id: string; data: ArtworkResponseDto }) {
  const router = useRouter()
  const safeBack = useSafeBack('/artworks')
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const setImages = useArtworkStore((state) => state.setImages)
  const setTotal = useArtworkStore((state) => state.setTotal)
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const [orderReviewOpen, setOrderReviewOpen] = useState(false)
  const [showScrolledTitle, setShowScrolledTitle] = useState(false)

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

  useEffect(() => {
    const marker = document.getElementById(`artwork-media-start-${data.id}`)
    if (!marker || typeof IntersectionObserver === 'undefined') return

    const toolbarBottom = isDesktop ? 128 : 56
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        setShowScrolledTitle(entry.boundingClientRect.top <= toolbarBottom)
      },
      { rootMargin: `-${toolbarBottom}px 0px 0px 0px`, threshold: 0 }
    )

    observer.observe(marker)
    return () => observer.disconnect()
  }, [data.id, isDesktop])

  return (
    <>
      <PageToolbar
        containerSize="reading"
        contentClassName="relative"
        leading={
          <Button variant="ghost" size="sm" onClick={safeBack} aria-label="返回作品列表" className="-ml-2 min-h-11">
            <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
            <span className="hidden sm:inline">返回</span>
          </Button>
        }
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="更多作品操作"
              >
                <EllipsisIcon data-icon="inline-start" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
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
                  >
                    <Settings2Icon aria-hidden="true" />
                    管理当前作品
                  </Link>
                </DropdownMenuItem>
                {data.images.length > 1 && (
                  <DropdownMenuItem onSelect={() => setOrderReviewOpen(true)}>
                    <ListOrderedIcon aria-hidden="true" />
                    顺序校对
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => {
                    setImages(data.images)
                    router.push('/artworks/preview')
                  }}
                >
                  <FullscreenIcon aria-hidden="true" />
                  全屏预览
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {showScrolledTitle && (
          <PrivacySensitiveText
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-16 truncate text-center text-sm font-medium text-foreground sm:inset-x-24"
          >
            {data.title}
          </PrivacySensitiveText>
        )}
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
