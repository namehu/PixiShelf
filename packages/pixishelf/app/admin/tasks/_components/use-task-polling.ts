'use client'

import { useCallback } from 'react'

export function useTaskPolling<T>(
  isActive: (data: T | undefined) => boolean,
  interval = 1_000,
  options: { liveConnected?: boolean; idleInterval?: number | false } = {}
) {
  return useCallback(
    (query: { state: { data: unknown } }) => {
      if (options.liveConnected) return false
      return isActive(query.state.data as T | undefined) ? interval : (options.idleInterval ?? false)
    },
    [interval, isActive, options.idleInterval, options.liveConnected]
  )
}
