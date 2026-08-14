'use client'

import { createPortal } from 'react-dom'
import { appendCacheKey } from './utils'
import type { ImageListItem } from './types'
import MediaThumbnail from '@/components/media/media-thumbnail'
import { isVideoCoverSource } from '@/lib/media-cover'

export const HoverPreview = ({
  media,
  x,
  y,
  visible,
  cacheKey
}: {
  media: ImageListItem | null
  x: number
  y: number
  visible: boolean
  cacheKey: number
}) => {
  if (!visible || !media) return null

  const thumbnailMedia =
    isVideoCoverSource(media)
      ? { ...media, posterUrl: media.posterUrl || null }
      : { ...media, path: appendCacheKey(media.path, cacheKey) }

  // 使用 Portal 挂载到 body，保证预览层级高于页面内容
  if (typeof document === 'undefined') return null

  // 计算可视区域，限制弹窗不出界
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 1000
  const screenH = typeof window !== 'undefined' ? window.innerHeight : 800

  // 靠近右/下边界时自动反向偏移避免溢出
  const finalX = x + 320 > screenW ? x - 340 : x + 20
  const finalY = y + 320 > screenH ? y - 320 : y + 20

  return createPortal(
    <div
      className="fixed z-[9999] bg-background/95 backdrop-blur-sm border rounded-lg shadow-xl p-2 animate-in fade-in zoom-in-95 duration-200"
      style={{ left: finalX, top: finalY, width: 320, maxWidth: '90vw' }}
    >
      <div className="relative aspect-square w-full bg-black/5 rounded-md overflow-hidden">
        <MediaThumbnail
          media={thumbnailMedia}
          alt="Preview"
          sizes="(max-width: 320px) 100vw, 320px"
          fill
          className="object-contain"
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground text-center break-all font-mono">
        {media.path.split('/').pop()}
      </div>
    </div>,
    document.body
  )
}
