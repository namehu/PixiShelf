/**
 * 标签图片下载模式
 */
export const ETagDownloadMode = {
  /** 单独下载 */
  individual: 'individual',
  /** 压缩下载 */
  zip: 'zip'
} as const

export type ETagDownloadMode = (typeof ETagDownloadMode)[keyof typeof ETagDownloadMode]

export const MTagDownloadMode = {
  [ETagDownloadMode.individual]: '单独下载',
  [ETagDownloadMode.zip]: '压缩下载'
}

export const OTagDownloadMode = [
  { value: ETagDownloadMode.individual, label: '单独下载' },
  { value: ETagDownloadMode.zip, label: '压缩下载' }
]
