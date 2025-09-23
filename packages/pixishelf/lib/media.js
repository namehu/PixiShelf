import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from './constant'

/**
 * 获取文件扩展名（小写）
 * @param filename 文件名或文件路径
 * @returns 文件扩展名（包含点号）
 */
export function getFileExtension(filename) {
  const lastDotIndex = filename.lastIndexOf('.')
  if (lastDotIndex === -1) {
    return ''
  }
  return filename.slice(lastDotIndex).toLowerCase()
}


/**
 * 判断文件是否为视频格式
 * @param filename 文件名或文件路径
 * @returns 是否为视频文件
 */
export function isVideoFile(filename) {
  const ext = getFileExtension(filename)
  return VIDEO_EXTENSIONS.includes(ext)
}

/**
 * 判断文件是否为图片格式
 * @param filename 文件名或文件路径
 * @returns 是否为图片文件
 */
export function isImageFile(filename) {
  const ext = getFileExtension(filename)
  return IMAGE_EXTENSIONS.includes(ext)
}
