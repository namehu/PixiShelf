'use client'

import { useMemo } from 'react'
import { getCurrentChapter, type NormalizedChapter } from './video-chapters'

/**
 * 根据当前播放时间计算所在章节。
 */
export function useCurrentChapter(chapters: NormalizedChapter[], currentTime: number) {
  return useMemo(() => getCurrentChapter(chapters, currentTime), [chapters, currentTime])
}
