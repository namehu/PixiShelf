'use client'

import { useSyncExternalStore } from 'react'

/**
 * 响应式列数 Hook (基于 useSyncExternalStore，React 18/19 安全)
 * 对应 Tailwind 的断点:
 * - default (< 640px): 2
 * - sm (>= 640px): 3
 * - md (>= 768px): 4
 * - lg (>= 1024px): 5
 */

function getColumns() {
  if (typeof window === 'undefined') return 2
  const width = window.innerWidth
  if (width >= 1024) return 5
  if (width >= 768) return 4
  if (width >= 640) return 3
  return 2
}

function subscribe(callback: () => void) {
  window.addEventListener('resize', callback)
  return () => window.removeEventListener('resize', callback)
}

export function useColumns() {
  return useSyncExternalStore(subscribe, getColumns, () => 2)
}
