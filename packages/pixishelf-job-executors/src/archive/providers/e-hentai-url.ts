import { ArchiveError } from '../errors.ts'

const GALLERY_HOST = 'e-hentai.org'

export function parseGalleryUrlIdentity(url: URL) {
  const gallery = url.pathname.match(/^\/g\/(\d+)\/([a-z0-9]+)\/?$/i)
  const page = url.pathname.match(/^\/s\/([a-z0-9]+)\/(\d+)-(\d+)\/?$/i)
  const rawGid = gallery?.[1] ?? page?.[2]
  const gid = Number(rawGid)
  if (!rawGid || !Number.isSafeInteger(gid) || gid <= 0) {
    throw new ArchiveError('INVALID_URL', '不支持的 E-Hentai 链接格式')
  }
  if (gallery) return { kind: 'GALLERY' as const, gid, token: gallery[2]! }
  const pageNumber = Number(page?.[3])
  if (!page || !Number.isSafeInteger(pageNumber) || pageNumber <= 0) {
    throw new ArchiveError('INVALID_URL', '不支持的 E-Hentai 图片页链接格式')
  }
  return { kind: 'PAGE' as const, gid, token: page[1]!, pageNumber }
}

export function parseSupportedUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    throw new ArchiveError('INVALID_URL', 'E-Hentai 链接格式无效', { cause: error })
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== GALLERY_HOST ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new ArchiveError('INVALID_URL', '仅支持 https://e-hentai.org 的公开画廊或图片页链接')
  }
  if (!/^\/(?:g|s)\//.test(url.pathname)) {
    throw new ArchiveError('INVALID_URL', '仅支持 /g/... 画廊链接和 /s/... 图片页链接')
  }
  url.hash = ''
  return url
}

