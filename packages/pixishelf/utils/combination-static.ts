import { API_IMAGE_PREFIX } from '@/lib/constant'

/**
 * 组合API资源路径
 * @param url 资源URL
 * @returns 组合后的API资源路径
 */
export function combinationApiResource(url?: string | null) {
  if (!url || url.startsWith(API_IMAGE_PREFIX)) {
    return url || ''
  }

  // 去掉开头的斜杠，避免拼接出双斜杠
  const trimmed = url.replace(/^\/+/, '')
  return API_IMAGE_PREFIX + encodeURIComponent(trimmed)
}
