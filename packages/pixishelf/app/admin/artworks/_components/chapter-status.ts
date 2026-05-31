import { ImageListItem } from './types'

export interface ChapterStatusSummary {
  text: string
  tone: 'muted' | 'success' | 'warning'
}

/**
 * 格式化章节总时长
 * @param seconds 秒数
 * @returns 章节时长标签
 */
export function formatChapterDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) {
    return '00:00'
  }

  const totalSeconds = Math.round(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60

  if (hours > 0) {
    return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':')
  }

  return [minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':')
}

/**
 * 计算章节状态文案
 * @param image 媒体项
 * @returns 状态摘要
 */
export function getChapterStatusSummary(image: ImageListItem): ChapterStatusSummary {
  if (image.mediaType !== 'video') {
    return {
      text: '-',
      tone: 'muted'
    }
  }

  if (image.hasChapters && (image.chaptersCount || 0) > 0) {
    return {
      text: `${image.chaptersCount} 段 / ${formatChapterDuration(image.chaptersDuration)}`,
      tone: 'success'
    }
  }

  if (image.chaptersPath || (image.chaptersCount || 0) > 0) {
    return {
      text: '章节数据异常',
      tone: 'warning'
    }
  }

  return {
    text: '无章节',
    tone: 'muted'
  }
}
