import { isVideoFile } from './media'
import { API_IMAGE_PREFIX } from './constant'

// ImgProxy 的服务地址，因为在 Docker Compose 网络中，可以直接用服务名
// 从浏览器访问时需要用宿主机的 IP 和端口
const IMGPROXY_URL = process.env.NEXT_PUBLIC_IMGPROXY_URL || 'http://localhost:5431';
const THUMBOR_VIDEO_URL = process.env.NEXT_PUBLIC_THUMBOR_VIDEO_URL || 'http://localhost:5433';

export default function imgproxyLoader({ src, width, quality }) {
  if (src.startsWith(API_IMAGE_PREFIX)) {
    return src
  }

  // 视频截帧用 自定义的Thumbor 组件
  if (isVideoFile(src)) {
    const finalUrl = `${THUMBOR_VIDEO_URL}/unsafe/${width || 800}x0/filters:still(0.1)${src}`;
    return finalUrl;
  }

  // 图片处理 https://docs.imgproxy.net/usage/processing
  /**
   * rs:fill:800:600:0: 裁剪为 800x600，0 表示不放大原图。
   * g:sm: 智能识别主体作为裁剪中心。
   * q:90: 图片质量为 90%。
   * sm:1: 去除所有元数据。
   * @webp: 指定输出格式为 WebP。
   */
  // - /unsafe/: 签名部分，如果未配置密钥则使用 unsafe
  // - ...processingOptions: 上面定义好的处理选项
  // - /${encodedSrc}: 编码后的源图片 URL
  // - .webp: 指定输出格式为高效的 WebP
  return `${IMGPROXY_URL}/_/rs:fit:${width}:0/q:${quality || 90}/sm:1/plain/local://${encodeURIComponent(src)}@webp`;
}

