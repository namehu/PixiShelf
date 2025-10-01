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
