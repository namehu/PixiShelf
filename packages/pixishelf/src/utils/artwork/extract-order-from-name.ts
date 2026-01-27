/**
 * 从文件名提取排序序号
 */
export function extractOrderFromName(fileName: string): number {
  const match = fileName.match(/[-_](\d+)|(\d+)/g)
  if (match) {
    const lastMatch = match[match.length - 1]
    return lastMatch !== undefined ? parseInt(lastMatch.replace(/[-_]/, ''), 10) : 0
  }
  return 0
}
