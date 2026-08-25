import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_INPUT_PIXELS = 40_000_000
const MAX_DIMENSION = 12_000
const REQUEST_TIMEOUT_MS = 15_000
const PIXIV_IMAGE_HOST = 'i.pximg.net'
const IMAGE_EXTENSIONS = new Map([
  ['jpeg', 'jpg'],
  ['png', 'png'],
  ['webp', 'webp'],
  ['gif', 'gif'],
  ['avif', 'avif']
])

export class PixivArtistImageError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'PixivArtistImageError'
  }
}

export async function storePixivArtistImage(input: {
  imageUrl: string
  pixivUserId: string
  kind: 'avatar' | 'background'
  pixivDataRoot: string
  signal: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<string> {
  if (!/^[1-9][0-9]*$/.test(input.pixivUserId)) {
    throw new PixivArtistImageError('Pixiv 用户 ID 无效', 'PIXIV_IMAGE_PATH_INVALID')
  }
  const fetchImpl = input.fetchImpl ?? fetch
  let url = new URL(input.imageUrl)
  let response: Response | null = null
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    assertPixivImageUrl(url)
    response = await fetchWithTimeout(fetchImpl, url, input.signal)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === 3) {
        throw new PixivArtistImageError('Pixiv 作者图片重定向无效', 'PIXIV_IMAGE_INVALID_REDIRECT')
      }
      url = new URL(location, url)
      response = null
      continue
    }
    break
  }
  if (!response?.ok) {
    throw new PixivArtistImageError('Pixiv 作者图片下载失败', 'PIXIV_IMAGE_DOWNLOAD_FAILED')
  }
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new PixivArtistImageError('Pixiv 作者图片超过 8 MiB 限制', 'PIXIV_IMAGE_TOO_LARGE')
  }
  const bytes = await readBoundedBody(response)
  const metadata = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
    .metadata()
    .catch(() => {
      throw new PixivArtistImageError('Pixiv 作者图片不是有效图片', 'PIXIV_IMAGE_INVALID')
    })
  const extension = metadata.format ? IMAGE_EXTENSIONS.get(metadata.format) : undefined
  if (!extension || !metadata.width || !metadata.height) {
    throw new PixivArtistImageError('Pixiv 作者图片格式不受支持', 'PIXIV_IMAGE_UNSUPPORTED')
  }
  if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    throw new PixivArtistImageError('Pixiv 作者图片尺寸超过限制', 'PIXIV_IMAGE_DIMENSIONS_EXCEEDED')
  }

  const artistsRoot = path.resolve(input.pixivDataRoot, 'artists')
  const artistRoot = path.resolve(artistsRoot, input.pixivUserId)
  if (path.dirname(artistRoot) !== artistsRoot) {
    throw new PixivArtistImageError('Pixiv 作者图片存储路径无效', 'PIXIV_IMAGE_PATH_INVALID')
  }
  // 内容寻址让刷新后的 URL 随图片变化，同时保证相同内容可以安全复用。
  const digest = createHash('sha256').update(bytes).digest('hex')
  const fileName = `${input.kind}-${digest}.${extension}`
  const destination = path.join(artistRoot, fileName)
  await fs.mkdir(artistRoot, { recursive: true })
  if (await isFile(destination)) return fileName

  const temporary = path.join(artistRoot, `.${input.kind}.${randomUUID()}.tmp`)
  await fs.writeFile(temporary, bytes, { flag: 'wx' })
  try {
    await fs.rename(temporary, destination)
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined)
    if (!(await isFile(destination))) throw error
  }
  return fileName
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: URL, signal: AbortSignal) {
  try {
    return await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif', referer: 'https://www.pixiv.net/' }
    })
  } catch (error) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : error
    throw new PixivArtistImageError('Pixiv 作者图片下载超时或网络异常', 'PIXIV_IMAGE_NETWORK_ERROR')
  }
}

async function readBoundedBody(response: Response): Promise<Buffer> {
  if (!response.body) throw new PixivArtistImageError('Pixiv 作者图片响应为空', 'PIXIV_IMAGE_EMPTY')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel()
      throw new PixivArtistImageError('Pixiv 作者图片超过 8 MiB 限制', 'PIXIV_IMAGE_TOO_LARGE')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}

function assertPixivImageUrl(url: URL) {
  if (url.protocol !== 'https:' || url.hostname !== PIXIV_IMAGE_HOST || (url.port && url.port !== '443')) {
    throw new PixivArtistImageError('Pixiv 作者图片地址不在允许列表中', 'PIXIV_IMAGE_HOST_REJECTED')
  }
}

async function isFile(filePath: string) {
  return fs
    .stat(filePath)
    .then((stat) => stat.isFile())
    .catch(() => false)
}
