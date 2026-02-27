export const appendCacheKey = (src: string, cacheKey: number) => {
  const separator = src.includes('?') ? '&' : '?'
  return `${src}${separator}v=${cacheKey}`
}
