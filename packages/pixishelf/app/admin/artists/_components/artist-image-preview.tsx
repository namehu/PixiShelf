'use client'

import { useEffect, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

export interface ArtistImagePreviewTarget {
  name: string
  image: string
  type: 'avatar' | 'background'
}

interface ArtistImageThumbnailProps {
  name: string
  image: string | null
  onPreview: (target: ArtistImagePreviewTarget) => void
}

export function ArtistAvatarThumbnail({ name, image, onPreview }: ArtistImageThumbnailProps) {
  const [loadFailed, setLoadFailed] = useState(false)
  const fallback = name.substring(0, 2).toUpperCase()

  useEffect(() => setLoadFailed(false), [image])

  if (!image || loadFailed) {
    return (
      <Avatar aria-label={`艺术家 ${name} 没有头像`}>
        <AvatarFallback>
          <PrivacySensitiveText>{fallback}</PrivacySensitiveText>
        </AvatarFallback>
      </Avatar>
    )
  }

  return (
    <button
      type="button"
      className="group rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => onPreview({ name, image, type: 'avatar' })}
      aria-label={`查看艺术家 ${name} 的头像`}
    >
      <Avatar>
        <AvatarImage
          src={image}
          alt=""
          className="transition-transform group-hover:scale-105 motion-reduce:transition-none"
          onError={() => setLoadFailed(true)}
        />
        <AvatarFallback>
          <PrivacySensitiveText>{fallback}</PrivacySensitiveText>
        </AvatarFallback>
      </Avatar>
    </button>
  )
}

export function ArtistBackgroundThumbnail({ name, image, onPreview }: ArtistImageThumbnailProps) {
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => setLoadFailed(false), [image])

  if (!image || loadFailed) {
    return (
      <span
        className="inline-flex h-11 w-20 rounded-md border border-dashed bg-muted/30"
        aria-label={`艺术家 ${name} 没有背景图`}
      />
    )
  }

  return (
    <button
      type="button"
      className="group relative inline-flex h-11 w-20 overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => onPreview({ name, image, type: 'background' })}
      aria-label={`查看艺术家 ${name} 的背景图`}
    >
      {/* 图片可能来自受 Session 保护的站内 API，也可能是管理员维护的外部 URL。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt=""
        className="size-full object-cover transition-transform group-hover:scale-105 motion-reduce:transition-none"
        loading="lazy"
        onError={() => setLoadFailed(true)}
      />
    </button>
  )
}

export function ArtistImagePreviewDialog({
  target,
  onOpenChange
}: {
  target: ArtistImagePreviewTarget | null
  onOpenChange: (open: boolean) => void
}) {
  const imageTypeLabel = target?.type === 'avatar' ? '头像' : '背景图'

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>
            {target ? (
              <>
                <PrivacySensitiveText>{target.name}</PrivacySensitiveText>的{imageTypeLabel}
              </>
            ) : (
              '艺术家图片预览'
            )}
          </DialogTitle>
          <DialogDescription>艺术家{imageTypeLabel}大图预览</DialogDescription>
        </DialogHeader>
        <div className="h-[70vh] max-h-[768px] min-h-72 w-full bg-muted/30">
          {target && (
            // 图片来源约束同缩略图，不能交给 next/image 的远程域名白名单处理。
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={target.image}
              alt={`艺术家 ${target.name} 的${imageTypeLabel}`}
              className="size-full object-contain"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
