export function withMediaVersion(url: string, version?: string | null) {
  if (!version) return url

  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${encodeURIComponent(version)}`
}
