const MOBILE_MAX_PRELOAD_BYTES = 6 * 1024 * 1024
const DESKTOP_MAX_PRELOAD_BYTES = 12 * 1024 * 1024
const MOBILE_MAX_PRELOAD_PIXELS = 20_000_000
const DESKTOP_MAX_PRELOAD_PIXELS = 40_000_000

export interface MediaPreloadEnvironment {
  isMobile: boolean
  saveData: boolean
  effectiveType?: string
}

export interface AdaptedImagePreloadCandidate {
  size?: number | null
  width?: number | null
  height?: number | null
  isAnimated?: boolean
}

export function canPreloadAdaptedImage(candidate: AdaptedImagePreloadCandidate, environment: MediaPreloadEnvironment) {
  if (environment.saveData || ['slow-2g', '2g'].includes(environment.effectiveType ?? '')) return false
  if (candidate.isAnimated) return false
  if (
    typeof candidate.size !== 'number' ||
    typeof candidate.width !== 'number' ||
    typeof candidate.height !== 'number'
  ) {
    return false
  }

  const maxBytes = environment.isMobile ? MOBILE_MAX_PRELOAD_BYTES : DESKTOP_MAX_PRELOAD_BYTES
  const maxPixels = environment.isMobile ? MOBILE_MAX_PRELOAD_PIXELS : DESKTOP_MAX_PRELOAD_PIXELS
  return candidate.size <= maxBytes && candidate.width * candidate.height <= maxPixels
}

export function readMediaPreloadEnvironment(): MediaPreloadEnvironment {
  if (typeof window === 'undefined') return { isMobile: true, saveData: false }

  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
  ).connection
  const environment: MediaPreloadEnvironment = {
    isMobile: window.innerWidth < 768,
    saveData: connection?.saveData === true
  }
  if (connection?.effectiveType) environment.effectiveType = connection.effectiveType
  return environment
}
