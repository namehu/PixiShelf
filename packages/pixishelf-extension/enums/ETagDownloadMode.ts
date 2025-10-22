/**
 * 标签图片下载模式
 */
export enum ETagDownloadMode {
  /** 单独下载 */
  Individual = 'individual',
  /** 压缩下载 */
  Zip = 'zip'
}
export const MTagDownloadMode = {
  [ETagDownloadMode.Individual]: '单独下载',
  [ETagDownloadMode.Zip]: '压缩下载'
}

export const OTagDownloadMode = [
  { value: ETagDownloadMode.Individual, label: '单独下载' },
  { value: ETagDownloadMode.Zip, label: '压缩下载' }
]
