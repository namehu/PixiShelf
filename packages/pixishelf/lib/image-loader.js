// lib/imgproxy-loader.js
// ImgProxy 的服务地址，因为在 Docker Compose 网络中，可以直接用服务名
// 从浏览器访问时需要用宿主机的 IP 和端口
const IMGPROXY_URL = process.env.NEXT_PUBLIC_IMGPROXY_URL || 'http://localhost:5431';

export default function imgproxyLoader({ src, width, quality }) {

  // 图片处理 https://docs.imgproxy.net/usage/processing
  /**
   * rs:fill:800:600:0: 裁剪为 800x600，0 表示不放大原图。
   * g:sm: 智能识别主体作为裁剪中心。
   * q:80: 图片质量为 80%。
   * sm:1: 去除所有元数据。
   * @webp: 指定输出格式为 WebP。
   */
  // 1. 定义处理选项
  // - rs:fit:${width}:0: 等比缩放到指定宽度，高度自动计算
  // - q:${quality || 75}: 使用 Next.js 提供的 quality 值，默认为 75
  // - sm:1: 移除图片元数据，优化体积
  const processingOptions = `rs:fit:${width}:0/q:${quality || 80}/sm:1/plain/`;

  // 3. 拼接最终的 imgproxy URL
  // - /unsafe/: 签名部分，如果未配置密钥则使用 unsafe
  // - ...processingOptions: 上面定义好的处理选项
  // - /${encodedSrc}: 编码后的源图片 URL
  // - .webp: 指定输出格式为高效的 WebP
  const finalUrl = `${IMGPROXY_URL}/_/${processingOptions}local://${src}@webp`;

  return finalUrl;
}

// http://localhost:5431/_/rs:fill:400:300:0/g:sm/q:80/sm:1/plain/local:///test.png@webp
