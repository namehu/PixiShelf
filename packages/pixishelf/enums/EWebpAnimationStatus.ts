export const EWebpAnimationStatus = {
  /** 待处理 */
  pending: 0,
  /** 静态 WebP */
  static: 1,
  /** 动态 WebP */
  animated: 2
} as const

export type EWebpAnimationStatus = (typeof EWebpAnimationStatus)[keyof typeof EWebpAnimationStatus]
