'use client'

import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const ARTWORK_DETAIL_STORAGE_KEY = 'pixishelf-artwork-detail-settings'

export function normalizePreviewCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(1, Math.round(value))) : 10
}

/**
 * 统一列表与导航的展示口径：图片、动图、视频均计一项。
 * 尾项容差向下取整且不设上限；自然全显不等于用户主动展开，也不提供收起。
 */
export function getArtworkDisplayPolicy(total: number, previewCount: number, expanded: boolean) {
  const limit = normalizePreviewCount(previewCount)
  const collapsible = total > limit + Math.floor(limit * 0.25)
  const visibleCount = collapsible && !expanded ? Math.min(total, limit) : total
  return { collapsible, visibleCount, remainingCount: total - visibleCount, fullyVisible: visibleCount === total }
}

export const useArtworkDetailPreferences = create<{
  previewCount: number
  setPreviewCount: (value: number) => void
}>()(
  persist(
    (set) => ({ previewCount: 10, setPreviewCount: (value) => set({ previewCount: normalizePreviewCount(value) }) }),
    {
      name: ARTWORK_DETAIL_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      // 只保存浏览器偏好；展开状态属于作品会话，恢复数据也不能覆盖 store 动作。
      partialize: ({ previewCount }) => ({ previewCount }),
      merge: (saved, current) => ({
        ...current,
        previewCount: normalizePreviewCount(
          saved && typeof saved === 'object' && 'previewCount' in saved ? saved.previewCount : undefined
        )
      })
    }
  )
)

/** 恢复偏好后再挂载列表，避免默认数量与已保存数量切换导致虚拟列表跳动。 */
export function useArtworkDetailPreferencesReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    // 存储被禁用或内容损坏时也要结束等待，允许使用当前内存中的偏好浏览。
    const hydration = useArtworkDetailPreferences.persist.rehydrate()
    if (useArtworkDetailPreferences.persist.hasHydrated()) setReady(true)
    void Promise.resolve(hydration)
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [])
  return ready
}
