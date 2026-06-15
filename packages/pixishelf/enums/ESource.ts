export const ESource = {
  /** Pixiv 导入 */
  PIXIV_IMPORTED: 'PIXIV_IMPORTED',
  /** 本地导入 */
  LOCAL_IMPORT: 'LOCAL_IMPORT',
  /** 本地创建 */
  LOCAL_CREATED: 'LOCAL_CREATED'
} as const

export type ESource = (typeof ESource)[keyof typeof ESource]

export const MSource = {
  [ESource.PIXIV_IMPORTED]: 'Pixiv 导入',
  [ESource.LOCAL_IMPORT]: '本地导入',
  [ESource.LOCAL_CREATED]: '本地创建'
}

export const OSource = [
  { value: ESource.PIXIV_IMPORTED, label: 'Pixiv 导入' },
  { value: ESource.LOCAL_IMPORT, label: '本地导入' },
  { value: ESource.LOCAL_CREATED, label: '本地创建' }
]
