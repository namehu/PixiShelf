'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArchivePreviewThumbnailDto } from '@/services/archive-preview/archive-preview-types'
import { cn } from '@/lib/utils'

interface SourcePreviewThumbnailProps {
  item: ArchivePreviewThumbnailDto
  alt: string
  eager?: boolean
  fullscreen?: boolean
  zoomTarget?: boolean
  className?: string
  onLoad?: () => void
  onError?: () => void
}

export function SourcePreviewThumbnail({
  item,
  alt,
  eager = false,
  fullscreen = false,
  zoomTarget = false,
  className,
  onLoad,
  onError
}: SourcePreviewThumbnailProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceImageRef = useRef<HTMLImageElement>(null)
  const notifiedLoadRef = useRef<string | null>(null)
  const drawnCanvasRef = useRef<string | null>(null)
  const onLoadRef = useRef(onLoad)
  const onErrorRef = useRef(onError)
  onLoadRef.current = onLoad
  onErrorRef.current = onError
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null)
  const [sourceSize, setSourceSize] = useState<{ cropKey: string; width: number; height: number } | null>(null)
  const [canvasReadyFor, setCanvasReadyFor] = useState<string | null>(null)
  const cropKey = item.crop
    ? `${item.url}:${item.crop.x}:${item.crop.y}:${item.crop.width}:${item.crop.height}`
    : item.url

  const readFrameSize = useCallback((size?: { width: number; height: number }) => {
    const frame = frameRef.current
    if (!frame) return
    const width = size?.width ?? frame.clientWidth
    const height = size?.height ?? frame.clientHeight
    if (width > 0 && height > 0) setFrameSize({ width, height })
  }, [])

  const reportLoaded = useCallback(() => {
    if (notifiedLoadRef.current === cropKey) return
    notifiedLoadRef.current = cropKey
    onLoadRef.current?.()
  }, [cropKey])

  const prepareListCrop = useCallback(
    (image: HTMLImageElement) => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        onErrorRef.current?.()
        return
      }
      readFrameSize()
      setSourceSize({ cropKey, width: image.naturalWidth, height: image.naturalHeight })
      reportLoaded()
    },
    [cropKey, readFrameSize, reportLoaded]
  )

  const drawFullscreenCrop = useCallback(
    (image: HTMLImageElement) => {
      const crop = item.crop
      const canvas = canvasRef.current
      if (
        !crop ||
        !canvas ||
        image.naturalWidth < crop.x + crop.width ||
        image.naturalHeight < crop.y + crop.height
      ) {
        onErrorRef.current?.()
        return
      }
      if (drawnCanvasRef.current === cropKey) {
        reportLoaded()
        return
      }
      try {
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas rendering is unavailable')
        context.clearRect(0, 0, crop.width, crop.height)
        context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
        drawnCanvasRef.current = cropKey
        setCanvasReadyFor(cropKey)
        reportLoaded()
      } catch {
        drawnCanvasRef.current = null
        setCanvasReadyFor(null)
        onErrorRef.current?.()
      }
    },
    [cropKey, item.crop, reportLoaded]
  )

  useEffect(() => {
    if (!item.crop) return
    const frame = frameRef.current
    if (!frame) return
    readFrameSize()
    const frameId = typeof requestAnimationFrame === 'undefined' ? null : requestAnimationFrame(() => readFrameSize())
    const resize = () => readFrameSize()
    window.addEventListener('resize', resize)
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(([entry]) => {
            if (entry) readFrameSize(entry.contentRect)
          })
    observer?.observe(frame)
    return () => {
      observer?.disconnect()
      if (frameId !== null) cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
    }
  }, [item.crop, readFrameSize])

  useEffect(() => {
    const image = sourceImageRef.current
    if (!image?.complete) return
    if (!item.crop) {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) reportLoaded()
      else onErrorRef.current?.()
      return
    }
    if (fullscreen) drawFullscreenCrop(image)
    else prepareListCrop(image)
  }, [cropKey, drawFullscreenCrop, fullscreen, item.crop, prepareListCrop, reportLoaded])

  const frameStyle = {
    aspectRatio: `${item.width} / ${item.height}`,
    ...(fullscreen
      ? { width: `min(100%, calc((100dvh - 8rem) * ${item.width} / ${item.height}))` }
      : undefined)
  }
  const frameClass = cn(
    'relative isolate w-full overflow-hidden bg-black/5 dark:bg-white/5',
    fullscreen && 'max-h-[calc(100dvh-8rem)] max-w-full',
    zoomTarget && 'swiper-zoom-target',
    className
  )

  if (!item.crop) {
    return (
      <div ref={frameRef} className={frameClass} style={frameStyle}>
        {/* The source host serves the thumbnail directly; the browser controls near-viewport fetching. */}
        {/* oxlint-disable-next-line nextjs/no-img-element */}
        <img
          ref={sourceImageRef}
          src={item.url}
          alt={alt}
          referrerPolicy="no-referrer"
          loading={eager ? 'eager' : 'lazy'}
          draggable={false}
          className="absolute inset-0 size-full select-none object-contain"
          onLoad={reportLoaded}
          onError={() => onErrorRef.current?.()}
        />
      </div>
    )
  }

  if (fullscreen) {
    return (
      <div ref={frameRef} className={frameClass} style={frameStyle} data-source-preview-crop data-source-preview-canvas-crop>
        <canvas
          ref={canvasRef}
          width={item.crop.width}
          height={item.crop.height}
          aria-hidden="true"
          className="absolute inset-0 size-full"
          style={{ visibility: canvasReadyFor === cropKey ? 'visible' : 'hidden' }}
        />
        {/* The direct source image is retained for browser loading and is never read back or exported. */}
        {/* oxlint-disable-next-line nextjs/no-img-element */}
        <img
          ref={sourceImageRef}
          src={item.url}
          alt={alt}
          referrerPolicy="no-referrer"
          loading={eager ? 'eager' : 'lazy'}
          draggable={false}
          className="pointer-events-none absolute left-0 top-0 size-px select-none opacity-0"
          onLoad={(event) => drawFullscreenCrop(event.currentTarget)}
          onError={() => onErrorRef.current?.()}
        />
      </div>
    )
  }

  const scaleX = frameSize ? frameSize.width / item.crop.width : 0
  const scaleY = frameSize ? frameSize.height / item.crop.height : 0
  const activeSourceSize = sourceSize?.cropKey === cropKey ? sourceSize : null
  const cropReady = activeSourceSize !== null && scaleX > 0 && scaleY > 0
  return (
    <div ref={frameRef} className={frameClass} style={frameStyle} data-source-preview-crop>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: 'inset(0)', contain: 'paint' }}
        data-source-preview-crop-clip
      >
        {/* oxlint-disable-next-line nextjs/no-img-element */}
        <img
          ref={sourceImageRef}
          src={item.url}
          alt={alt}
          referrerPolicy="no-referrer"
          loading={eager ? 'eager' : 'lazy'}
          draggable={false}
          className="block max-w-none select-none"
          style={
            cropReady
              ? {
                  width: activeSourceSize.width * scaleX,
                  height: activeSourceSize.height * scaleY,
                  marginLeft: -item.crop.x * scaleX,
                  marginTop: -item.crop.y * scaleY
                }
              : { visibility: 'hidden' }
          }
          onLoad={(event) => {
            prepareListCrop(event.currentTarget)
          }}
          onError={() => onErrorRef.current?.()}
        />
      </div>
    </div>
  )
}
