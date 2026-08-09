export const EMediaAnimationStatus = {
  /** 待进行内容探测 */
  pending: 0,
  /** 单帧静态图片 */
  static: 1,
  /** 多帧动画图片 */
  animated: 2
} as const

export type EMediaAnimationStatus = (typeof EMediaAnimationStatus)[keyof typeof EMediaAnimationStatus]
