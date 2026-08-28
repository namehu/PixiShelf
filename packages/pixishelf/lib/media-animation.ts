import { EMediaAnimationStatus } from '@/enums/e-media-animation-status'
import { isWebpFile } from '@/lib/media'

interface AnimationMediaState {
  path: string
  isAnimated?: boolean
  webpAnimationStatus?: number | null
}

export function isConfirmedStaticWebp(media: AnimationMediaState) {
  return isWebpFile(media.path) && media.webpAnimationStatus === EMediaAnimationStatus.static
}

export function hasReliableSingleFrameDimensions(media: AnimationMediaState) {
  return (
    !media.isAnimated &&
    media.webpAnimationStatus !== EMediaAnimationStatus.pending &&
    media.webpAnimationStatus !== EMediaAnimationStatus.animated
  )
}
