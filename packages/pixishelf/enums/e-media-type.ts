export const EMediaType = {
  /** 所有 */
  all: 'all',
  /** 图片 */
  image: 'image',
  /** 动图 */
  animation: 'animation',
  /** 视频 */
  video: 'video'
} as const

export type EMediaType = (typeof EMediaType)[keyof typeof EMediaType]

export const MMediaType = {
  [EMediaType.all]: '所有',
  [EMediaType.image]: '图片',
  [EMediaType.animation]: '动图',
  [EMediaType.video]: '视频'
}

export const OMediaType = [
  { value: EMediaType.all, label: '所有' },
  { value: EMediaType.image, label: '图片' },
  { value: EMediaType.animation, label: '动图' },
  { value: EMediaType.video, label: '视频' }
]
