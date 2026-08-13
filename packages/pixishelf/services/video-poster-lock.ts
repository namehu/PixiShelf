export const VIDEO_POSTER_LOCK_NAMESPACE = 728_346

export function getVideoPosterImageIdFromFileName(fileName: string) {
  const match = /^(\d+)-/.exec(fileName)
  if (!match) return null
  const imageId = Number(match[1])
  return Number.isInteger(imageId) && imageId > 0 && imageId <= 2_147_483_647 ? imageId : null
}

export function isTemporaryVideoPosterFile(fileName: string) {
  return fileName.endsWith('.tmp.webp')
}
