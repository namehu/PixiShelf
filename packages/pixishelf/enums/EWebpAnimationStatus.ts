import { EMediaAnimationStatus } from './EMediaAnimationStatus'

/**
 * @deprecated 历史名称。数据库字段仍叫 webpAnimationStatus，但状态现已用于所有可动画图片。
 */
export const EWebpAnimationStatus = EMediaAnimationStatus

export type EWebpAnimationStatus = (typeof EWebpAnimationStatus)[keyof typeof EWebpAnimationStatus]
