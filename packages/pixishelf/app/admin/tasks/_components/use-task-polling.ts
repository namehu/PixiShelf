'use client'

import { useCallback } from 'react'

export function useTaskPolling<T>(isActive: (data: T | undefined) => boolean, interval = 1_000) {
  return useCallback(
    (query: { state: { data: unknown } }) => (isActive(query.state.data as T | undefined) ? interval : false),
    [interval, isActive]
  )
}
