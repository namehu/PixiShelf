/**
 * 组合艺术家头像路径
 * @param userId 艺术家用户ID
 * @param avatar 头像文件名
 * @returns 组合后的头像路径
 */
export function combinationStaticAvatar(userId?: string | null, avatar?: string | null) {
  return userId && avatar ? `/pixiv_data/artists/${userId}/${avatar}` : ''
}

/**
 * 组合艺术家背景图片路径
 * @param userId 艺术家用户ID
 * @param backgroundImg 背景图片文件名
 * @returns 组合后的背景图片路径
 */
export function combinationStaticArtistBg(userId?: string | null, backgroundImg?: string | null) {
  return userId && backgroundImg ? `/pixiv_data/artists/${userId}/${backgroundImg}` : ''
}

/**
 * 组合标签图片路径
 * @param image 标签图片文件名
 * @returns 组合后的标签图片路径
 */
export function combinationStaticTagImage(image?: string | null) {
  return image ? `/pixiv_data/tags${image}` : ''
}

/**
 * 组合API资源路径
 * @param url 资源URL
 * @returns 组合后的API资源路径
 */
export function combinationApiResource(url?: string | null) {
  return url ? `/api/v1/images/${encodeURIComponent(url)}` : ''
}
