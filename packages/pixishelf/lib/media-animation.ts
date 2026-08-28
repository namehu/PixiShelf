import { EMediaAnimationStatus } from '@/enums/e-media-animation-status'
import { isWebpFile } from '@/lib/media'

interface AnimationMediaState {
  path: string
  webpAnimationStatus?: number | null
}

export function isConfirmedStaticWebp(media: AnimationMediaState) {
  return isWebpFile(media.path) && media.webpAnimationStatus === EMediaAnimationStatus.static
}
