export enum EMediaType {
  /** 所有 */
  all = 'all',
  /** 图片 */
  image = 'image',
  /** 视频 */
  video = 'video'
}
export const MMediaType = {
  [EMediaType.all]: '所有',
  [EMediaType.image]: '图片',
  [EMediaType.video]: '视频'
}

export const OMediaType = [
  { value: EMediaType.all, label: '所有' },
  { value: EMediaType.image, label: '图片' },
  { value: EMediaType.video, label: '视频' }
]
