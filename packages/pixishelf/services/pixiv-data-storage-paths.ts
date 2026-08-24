import path from 'node:path'

export function getPixivDataStorageRoot(options?: { configuredPath?: string; cwd?: string }): string {
  // 生产环境使用独立的只读 Pixiv data 挂载；默认值仅用于读取既有本地开发数据。
  const configuredPath = options?.configuredPath ?? process.env.PIXIV_DATA_STORAGE_PATH
  const cwd = options?.cwd ?? process.cwd()
  return path.resolve(configuredPath?.trim() || path.join(cwd, 'public', 'pixiv_data'))
}

export const PIXIV_DATA_STORAGE_ROOT = getPixivDataStorageRoot()
export const PIXIV_TAG_STORAGE_ROOT = path.join(PIXIV_DATA_STORAGE_ROOT, 'tags')
export const PIXIV_ARTIST_STORAGE_ROOT = path.join(PIXIV_DATA_STORAGE_ROOT, 'artists')
