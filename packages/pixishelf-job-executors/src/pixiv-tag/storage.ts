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

// Pixiv 返回的 URL 只用于本次下载；数据库只记录内容哈希文件名，避免依赖远程 URL 的长期可用性。

export class PixivTagImageError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'PixivTagImageError'
  }
}

export async function storePixivTagImage(input: {
  imageUrl: string
  pixivDataRoot: string
  signal: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch
  let url = new URL(input.imageUrl)
  let response: Response | null = null

  for (let redirect = 0; redirect <= 3; redirect += 1) {
    // 图片 CDN 重定向也必须逐跳校验，不能让 fetch 的自动重定向绕过域名白名单。
    assertPixivImageUrl(url)
    response = await fetchWithTimeout(fetchImpl, url, input.signal)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === 3) {
        throw new PixivTagImageError('Pixiv 标签封面重定向无效', 'PIXIV_IMAGE_INVALID_REDIRECT')
      }
      url = new URL(location, url)
      response = null
      continue
    }
    break
  }

  if (!response?.ok) {
    throw new PixivTagImageError(
      `Pixiv 标签封面下载失败（${response?.status ?? 'unknown'}）`,
      'PIXIV_IMAGE_DOWNLOAD_FAILED'
    )
  }
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new PixivTagImageError('Pixiv 标签封面超过 8 MiB 限制', 'PIXIV_IMAGE_TOO_LARGE')
  }
  let bytes: Buffer
  try {
    bytes = await readBoundedBody(response, MAX_IMAGE_BYTES)
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : error
    if (error instanceof PixivTagImageError) throw error
    throw new PixivTagImageError('Pixiv 标签封面下载超时或网络异常', 'PIXIV_IMAGE_NETWORK_ERROR')
  }
  const metadata = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
    .metadata()
    .catch(() => {
      throw new PixivTagImageError('Pixiv 标签封面不是有效图片', 'PIXIV_IMAGE_INVALID')
    })
  const extension = metadata.format ? IMAGE_EXTENSIONS.get(metadata.format) : undefined
  if (!extension || !metadata.width || !metadata.height) {
    throw new PixivTagImageError('Pixiv 标签封面格式不受支持', 'PIXIV_IMAGE_UNSUPPORTED')
  }
  if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    throw new PixivTagImageError('Pixiv 标签封面尺寸超过限制', 'PIXIV_IMAGE_DIMENSIONS_EXCEEDED')
  }

  const digest = createHash('sha256').update(bytes).digest('hex')
  const fileName = `${digest}.${extension}`
  const tagRoot = path.resolve(input.pixivDataRoot, 'tags')
  const destination = path.resolve(tagRoot, fileName)
  if (path.dirname(destination) !== tagRoot) {
    throw new PixivTagImageError('Pixiv 标签封面存储路径无效', 'PIXIV_IMAGE_PATH_INVALID')
  }

  await fs.mkdir(tagRoot, { recursive: true })
  if (await isFile(destination)) return fileName

  const temporary = path.join(tagRoot, `.${digest}.${randomUUID()}.tmp`)
  // 临时文件加 wx + rename，保证并发任务不会看到半写入文件，也允许相同内容安全复用。
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
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
  try {
    return await fetchImpl(url, {
      redirect: 'manual',
      signal: requestSignal,
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif', referer: 'https://www.pixiv.net/' }
    })
  } catch (error) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : error
    throw new PixivTagImageError('Pixiv 标签封面下载超时或网络异常', 'PIXIV_IMAGE_NETWORK_ERROR')
  }
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Buffer> {
  if (!response.body) throw new PixivTagImageError('Pixiv 标签封面响应为空', 'PIXIV_IMAGE_EMPTY')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximumBytes) {
      await reader.cancel()
      throw new PixivTagImageError('Pixiv 标签封面超过 8 MiB 限制', 'PIXIV_IMAGE_TOO_LARGE')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}

function assertPixivImageUrl(url: URL) {
  if (
    url.protocol !== 'https:' ||
    url.hostname !== PIXIV_IMAGE_HOST ||
    (url.port.length > 0 && url.port !== '443') ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new PixivTagImageError('Pixiv 标签封面地址不在允许列表中', 'PIXIV_IMAGE_HOST_REJECTED')
  }
}

async function isFile(filePath: string) {
  return fs
    .stat(filePath)
    .then((stat) => stat.isFile())
    .catch(() => false)
}
