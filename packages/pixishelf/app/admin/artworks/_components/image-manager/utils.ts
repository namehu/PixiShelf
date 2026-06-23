import { Info, Volume2, VolumeX } from 'lucide-react'
import { VIDEO_EXTENSIONS } from '@/lib/constant'
import type { ImageListItem } from '../types'

export function isVideoImageListItem(image: ImageListItem): boolean {
  if (image.mediaType) {
    return image.mediaType === 'video'
  }

  const ext = `.${image.path.split('.').pop()?.toLowerCase() || ''}`
  return VIDEO_EXTENSIONS.includes(ext)
}

export function getChapterActionLabel(image: ImageListItem): string {
  return image.hasChapters ? '替换章节' : '上传章节'
}

export function getVideoMetadataSummary(image: ImageListItem) {
  if (image.probeStatus === 'FAILED') {
    return {
      label: '失败',
      icon: Info,
      className: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
    }
  }

  if (image.hasAudio === true) {
    return {
      label: '有音频',
      icon: Volume2,
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
    }
  }

  if (image.hasAudio === false) {
    return {
      label: '无音频',
      icon: VolumeX,
      className: 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100'
    }
  }

  return {
    label: '未探测',
    icon: Info,
    className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
  }
}

export function getImageAspectRatio(img: ImageListItem): string {
  if (!img.width || !img.height || img.width <= 0 || img.height <= 0) {
    return '3 / 4'
  }
  return `${img.width} / ${img.height}`
}

export function getNextImageSortOrder(imageList: ImageListItem[]): number {
  return imageList.length > 0 ? Math.max(...imageList.map((i) => i.sortOrder)) + 1 : 1
}

export function getFirstImageDirectory(artwork: { images?: Array<{ path?: string | null }> }): string | null {
  const [image] = artwork.images || []
  return image?.path ? image.path.split('/').slice(0, -1).join('/') : null
}

export function getImageManagerStats(imageList: ImageListItem[]): { count: number; totalSize: number } {
  return {
    count: imageList.length,
    totalSize: imageList.reduce((acc, cur) => acc + (cur.size || 0), 0)
  }
}
