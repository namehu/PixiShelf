import path from 'path'

/**
 * 获取相对路径
 * @param fullPath 完整路径
 * @param scanPath 扫描路径
 * @returns 相对路径
 */
export function getRelativePath(fullPath: string, scanPath: string): string {
  // 统一为 POSIX 风格，确保数据库始终使用 / 分隔符。
  const normFull = fullPath.replace(/\\/g, '/')
  const normScan = scanPath.replace(/\\/g, '/')

  return normFull.replace(normScan, '') // WARNNING: 历史原因 需要保留 / 开头...
}

/**
 * 获取元数据文件的相对路径
 * @param fullPath 完整路径
 * @param scanPath 扫描路径
 * @returns 相对路径
 */
export function getMetaSource(fullPath: string, scanPath: string): string {
  return getRelativePath(fullPath, scanPath).replace(/^\//, '')
}

/**
 * 获取路径中的文件名
 * @param input 路径
 * @returns 文件名
 */
export function getPathBasename(input: string): string {
  return path.basename(input.replace(/\\/g, '/'))
}
