// lib/imgproxy-loader.js

export default function imgproxyLoader({ src, width, quality }) {
  // ImgProxy 的服务地址，因为在 Docker Compose 网络中，可以直接用服务名
  // 从浏览器访问时需要用宿主机的 IP 和端口，如 http://localhost:8080
  const imgproxyUrl = process.env.NEXT_PUBLIC_IMGPROXY_URL || 'http://localhost:8080';

  // ImgProxy URL 格式：/{processing_options}/{encoded_source_url}
  // 这里的 `local://` 告诉 ImgProxy 从本地文件系统加载
  // `src` 应该是相对于挂载目录 `/data` 的路径，例如 `/image1.high-res.jpg`
  const sourceUrl = `local://${src}`;

  // 使用 base64 URL-safe 编码源 URL
  const encodedSourceUrl = Buffer.from(sourceUrl, 'utf-8').toString('base64url');

  // 处理选项：缩放到指定宽度，自动高度，webp格式，指定质量
  const processingOptions = `resize:fit:${width}:0:0/format:webp/q:${quality || 75}`;

  console.log(`---------------${imgproxyUrl}/${processingOptions}/${encodedSourceUrl}`);

  return `${imgproxyUrl}/${processingOptions}/${encodedSourceUrl}`;
}
