/**
 * 判断文件名是否为章节清单
 * @param fileName 文件名
 * @returns 是否为章节文件
 */
export function isChapterManifestFileName(fileName: string): boolean {
  const lowerName = fileName.toLowerCase()
  return lowerName.endsWith('.chapters.json') || lowerName.endsWith('..chapters.json')
}

/**
 * 从章节文件名提取视频 basename
 * @param fileName 章节文件名
 * @returns 视频 basename 或 null
 */
export function getVideoBaseNameFromChapterFile(fileName: string): string | null {
  if (!isChapterManifestFileName(fileName)) {
    return null
  }

  if (fileName.toLowerCase().endsWith('..chapters.json')) {
    return fileName.slice(0, -'..chapters.json'.length)
  }

  return fileName.slice(0, -'.chapters.json'.length)
}

/**
 * 基于视频文件名生成规范章节文件名
 * @param videoFileName 视频文件名
 * @returns 章节文件名
 */
export function buildCanonicalChapterFileName(videoFileName: string): string {
  const extIndex = videoFileName.lastIndexOf('.')
  const baseName = extIndex >= 0 ? videoFileName.slice(0, extIndex) : videoFileName
  return `${baseName}.chapters.json`
}
