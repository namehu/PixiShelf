'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

export const NAV_CURRENT_KEY = 'pixishelf:navigation:current'
export const NAV_PREVIOUS_KEY = 'pixishelf:navigation:previous'

export function getCurrentBrowserPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export function useSafeBack(fallbackHref = '/dashboard') {
  const router = useRouter()

  return useCallback(() => {
    const currentPath = getCurrentBrowserPath()
    const previousPath = sessionStorage.getItem(NAV_PREVIOUS_KEY)
    const hasTrackedPrevious = Boolean(previousPath && previousPath !== currentPath)
    const hasSameOriginReferrer = document.referrer ? new URL(document.referrer).origin === window.location.origin : false

    if (hasTrackedPrevious || hasSameOriginReferrer) {
      router.back()
      return
    }

    router.push(fallbackHref)
  }, [fallbackHref, router])
}
