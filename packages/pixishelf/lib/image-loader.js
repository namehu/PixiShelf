import { isGifFile, isVideoFile, isWebpFile } from './media'
import { API_IMAGE_PREFIX } from './constant'
import { isDerivedMediaPublicUrl, resolveDerivedMediaSource } from './derived-media'
import { PIXIV_DATA_API_PREFIX } from './pixiv-data'

// ImgProxy 的服务地址，因为在 Docker Compose 网络中，可以直接用服务名
// 从浏览器访问时需要用宿主机的 IP 和端口
const IMGPROXY_URL = process.env.NEXT_PUBLIC_IMGPROXY_URL || 'http://localhost:5431'
const DEFAULT_IMAGE_OUTPUT_FORMAT = 'webp'
const STATIC_ANIMATION_THUMBNAIL_FORMAT = 'jpg'
const VIDEO_THUMBNAIL_PLACEHOLDER_URL = '/video-thumbnail-unavailable.svg'
const reportedVideoSources = new Set()

function splitSourceVersion(src) {
  const queryIndex = src.indexOf('?')
  if (queryIndex < 0) return { source: src, version: null }

  const source = src.slice(0, queryIndex)
  const params = new URLSearchParams(src.slice(queryIndex + 1))
  return { source, version: params.get('v') }
}

function appendVersion(url, version) {
  return version ? `${url}?v=${encodeURIComponent(version)}` : url
}

/**
 * @typedef {Object} ImgproxyImageOptions
 * @property {string} src
 * @property {number} width
 * @property {number=} quality
 * @property {string=} format
 */

/**
 * @param {ImgproxyImageOptions} options
 */
export function buildImgproxyImageUrl({ src, width, quality, format = DEFAULT_IMAGE_OUTPUT_FORMAT }) {
  return `${IMGPROXY_URL}/_/rs:fit:${width}:0/q:${quality || 90}/sm:1/plain/local://${encodeURIComponent(src)}@${format}`
}

/**
 * @param {ImgproxyImageOptions} options
 */
export default function imgproxyLoader({ src, width, quality, format }) {
  // 受鉴权的媒体 API 自行负责读取文件，不交给 ImgProxy 解析本地路径。
  if (src.startsWith(API_IMAGE_PREFIX) || src.startsWith(PIXIV_DATA_API_PREFIX)) {
    return src
  }

  // 所有派生图片共用一个 ImgProxy 根挂载；虚拟 URL 前缀保持稳定。
  const derivedMedia = resolveDerivedMediaSource(src)
  if (derivedMedia) {
    const derivedMediaUrl = buildImgproxyImageUrl({
      src: derivedMedia.imgproxySourcePath,
      width,
      quality,
      format: 'webp'
    })
    return derivedMedia.version ? `${derivedMediaUrl}?v=${encodeURIComponent(derivedMedia.version)}` : derivedMediaUrl
  }
  if (isDerivedMediaPublicUrl(src)) return src

  const { source, version } = splitSourceVersion(src)

  // 原始视频必须由播放器展示；缩略图必须使用预先生成的静态封面。
  if (isVideoFile(source)) {
    if (!reportedVideoSources.has(source)) {
      reportedVideoSources.add(source)
      console.error(
        `[PixiShelf image-loader] Unsupported raw video source passed to next/image: "${source}". Use MediaThumbnail with a generated poster or render the video player.`
      )
    }
    return VIDEO_THUMBNAIL_PLACEHOLDER_URL
  }

  // 图片处理 https://docs.imgproxy.net/usage/processing
  /**
   * rs:fill:800:600:0: 裁剪为 800x600，0 表示不放大原图。
   * g:sm: 智能识别主体作为裁剪中心。
   * q:90: 图片质量为 90%。
   * sm:1: 去除所有元数据。
   * @webp/@jpg/@png: 指定输出格式。WebP/GIF 统一转静态 JPG，避免返回缩放后的动图。
   */
  // - /unsafe/: 签名部分，如果未配置密钥则使用 unsafe
  // - ...processingOptions: 上面定义好的处理选项
  // - /${encodedSrc}: 编码后的源图片 URL
  const outputFormat =
    format ||
    (isWebpFile(source) || isGifFile(source) ? STATIC_ANIMATION_THUMBNAIL_FORMAT : DEFAULT_IMAGE_OUTPUT_FORMAT)

  const mediaPath = source.startsWith('/') ? `/media${source}` : `/media/${source}`
  return appendVersion(buildImgproxyImageUrl({ src: mediaPath, width, quality, format: outputFormat }), version)
}
