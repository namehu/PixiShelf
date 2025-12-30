/**
 * 格式化文件大小
 * @param bytes 文件大小（字节）
 * @param decimals 保留的小数位数，默认为 1
 * @returns 格式化后的字符串 (e.g., "1.5 MB")
 */
export const formatFileSize = (bytes: number, decimals: number = 1): string => {
  if (bytes === 0) return '0 B'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}
