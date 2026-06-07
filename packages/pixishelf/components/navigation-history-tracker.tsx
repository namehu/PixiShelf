'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { NAV_CURRENT_KEY, NAV_PREVIOUS_KEY } from '@/hooks/use-safe-back'

export function NavigationHistoryTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasMountedRef = useRef(false)

  useEffect(() => {
    const query = searchParams.toString()
    const nextPath = `${pathname}${query ? `?${query}` : ''}`
    const currentPath = sessionStorage.getItem(NAV_CURRENT_KEY)

    if (!hasMountedRef.current) {
      hasMountedRef.current = true

      if (currentPath !== nextPath) {
        sessionStorage.removeItem(NAV_PREVIOUS_KEY)
      }

      sessionStorage.setItem(NAV_CURRENT_KEY, nextPath)
      return
    }

    if (currentPath && currentPath !== nextPath) {
      sessionStorage.setItem(NAV_PREVIOUS_KEY, currentPath)
    }

    sessionStorage.setItem(NAV_CURRENT_KEY, nextPath)
  }, [pathname, searchParams])

  return null
}
