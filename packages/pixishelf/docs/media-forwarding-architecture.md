# PixiShelf 媒体资源处理与分发架构设计

## 1. 架构概述

在生产环境中，PixiShelf 采用微服务架构来处理繁重的媒体资源（图片裁剪、缩放、格式转换、视频截帧等）。应用核心（Next.js）、图片处理引擎（ImgProxy）和视频处理引擎（Thumbor）被拆分为独立的服务，并通过 Traefik 进行统一的请求路由和负载均衡。

## 2. 请求转发链路与核心组件

### 2.1 客户端请求生成 (`image-loader.js`)
在 Next.js 的前端组件中，当使用 `next/image` 时，我们配置了自定义的 `loader`（`image-loader.js`）。它的核心作用是**绕过 Next.js 的内置图片优化，根据资源类型生成指向独立媒体服务的 URL**。
- **图片处理**：生成带有 `NEXT_PUBLIC_IMGPROXY_URL`（对应网关的 `/_image`）前缀的 URL，附带处理参数（如按需缩放、智能裁剪、强制 WebP 输出）。
- **视频截帧**：判断为视频文件时，生成带有 `NEXT_PUBLIC_THUMBOR_VIDEO_URL`（对应网关的 `/_video`）前缀的 URL，调用 Thumbor 的视频截帧滤镜（`filters:still`）。

### 2.2 网关路由分发 (`docker-compose.deploy.yml` 中的 Traefik)
用户浏览器发起请求后，流量首先到达 Traefik 代理网关。
- **图片路由 (`/_image/*`)**：
  - Traefik 匹配到 `PathPrefix('/_image')` 规则。
  - 使用 `strip-image-prefix` 中间件动态剥离掉 `/_image` 路径前缀。
  - 将干净的请求透明转发给后端的 `imgproxy` 容器（内部 5431 端口）。
- **视频路由 (`/_video/*`)**：
  - Traefik 匹配到 `PathPrefix('/_video')` 规则。
  - 使用 `strip-video-prefix` 中间件剥离掉 `/_video` 路径前缀。
  - 将请求转发给后端的 `thumbor` 容器（内部 80 端口）。

### 2.3 物理层存储共享 (Docker Volumes)
媒体服务之所以能极速响应，是因为**避免了通过内部网络传输原文件字节流**：
`app`、`imgproxy` 和 `thumbor` 容器都通过 Docker Volumes 只读（`ro`）挂载了相同的宿主机数据目录（例如 `/vol02/1001/pixiv`）。
因此，ImgProxy / Thumbor 收到包含相对路径的请求后，直接从自身的本地文件系统（`/data` 或 `/media`）高速读取原文件进行处理并流式返回。

---

## 3. 核心问题解答：为什么要用 `/_image` / `/_video` 转发而不是直接交给 Next.js Loader 处理？

在生产环境中，我们选择放弃 Next.js 内置图片优化（Node.js 服务器处理），转而采用 **独立服务 + Traefik 路径转发** 模式，主要基于以下四个维度的考量：

### 3.1 性能与资源隔离（突破 Node.js 单线程瓶颈）
Next.js 的内置图片优化依赖 Node.js 进程中的 Sharp 库进行图像处理。对于像 PixiShelf 这样拥有海量高清画作/视频的画廊应用，如果同一时间有大量用户浏览，密集的图片缩放和格式转换会迅速榨干 Node.js 进程的 CPU 资源，导致主线程阻塞。这不仅会让图片加载缓慢，**还会直接拖垮整个 Next.js 提供的 API 服务和页面 SSR 渲染**。
将高 CPU 消耗的媒体处理剥离给基于 Go 编写的 ImgProxy 和 Python 编写的 Thumbor，实现了**计算资源的物理隔离**，保护了主业务的稳定性。

### 3.2 规避不必要的网络 IO (数据本地化优势)
如果 Next.js 自己处理外部挂载目录中的图片，它必须把文件读入 Node.js 内存然后再吐出。
在当前架构下，Traefik 网关直接将 `/_image` 流量分发给 ImgProxy。ImgProxy 通过 Volume 直读本地磁盘文件（`IMGPROXY_LOCAL_FILESYSTEM_ROOT=/data`），处理完后直接经由 Traefik 响应给客户端。**这条数据链路完全不经过 Next.js 容器**，大幅节省了 Next.js 的带宽和内存开销。

### 3.3 专业的媒体处理能力边界
- **视频截帧与动图支持**：Next.js 内置图片组件**不支持**视频文件截帧和 GIF 高效转换。而 Thumbor 配合 `thumbor_video_engine` 可以完美实现视频第一帧提取和 GIF 转 WebP/H265。
- **防 OOM 与超大图处理**：画廊应用经常会遇到 8K 甚至更大分辨率的插画原图。ImgProxy 在底层针对大图防 OOM（内存溢出）做了极致优化，比 Node.js 下的 Sharp 更加健壮。

### 3.4 缓存策略的精细化控制
独立的 `/_image` 和 `/_video` API 路径使得我们在未来更容易接入 CDN（如 Cloudflare）。这些专门用于媒体分发的端点具有高度的确定性（URL 即包含了所有的裁剪、压缩参数），并且不包含用户的 Session Cookie，这能够实现 **极高的 CDN 缓存命中率**。
