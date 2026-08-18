# PixiShelf 媒体资源处理与分发架构

## 1. 当前架构

PixiShelf 将静态图片处理、视频派生媒体生成和原视频播放拆成三条明确链路：

- ImgProxy 负责普通图片、静态视频封面、章节截图和代表帧的缩放、格式转换与缓存。
- 通用 Worker 使用 FFmpeg 提前生成视频封面等静态 WebP 派生媒体，并写入派生媒体目录。
- 作品详情、全屏预览和沉浸浏览使用视频播放器读取原始视频，不经过 `next/image`。

系统不再提供请求时实时视频截帧服务，也不再声明 Thumbor 容器或 `/_video` 路由。

## 2. 图片请求链路

### 2.1 普通图片

Next.js 的自定义 `image-loader.js` 根据 `NEXT_PUBLIC_IMGPROXY_URL` 生成 ImgProxy URL。ImgProxy 通过
只读挂载访问原媒体目录，对图片进行按宽度缩放、质量控制、元数据清理和格式转换。普通静态图片默认
输出 WebP；GIF 和 WebP 缩略图输出静态 JPG，避免在列表中加载缩放后的动图。

### 2.2 视频派生静态图片

FFmpeg 任务生成的资源使用稳定的虚拟前缀：

- `/_video-posters/`：视频封面；
- `/_video-chapter-previews/`：章节截图；
- `/_video-keyframes/`：视频代表帧。

loader 通过派生媒体路径解析器把这些 URL 映射到 ImgProxy 的 `/derived-media/` 只读挂载。URL 中的版本
参数只作为浏览器缓存键，不会进入本地文件路径。

### 2.3 原始视频误传保护

所有封面和缩略图入口必须使用 `MediaThumbnail`：存在静态封面时渲染封面，不存在时渲染“封面待生成”
占位，不把原始视频路径交给 `next/image`。

如果后续代码仍误把原始视频传给图片 loader，loader 会返回 `/video-thumbnail-unavailable.svg`，并按原始
路径记录一次明确错误。该保护只用于暴露调用方错误，不会重新引入实时截帧。

## 3. 视频和动图播放

- 原视频由 `<video>`/视频播放器按原始媒体 URL 加载，并继续支持章节、代表帧、音频状态和播放控制。
- GIF、APNG 和动态 WebP 的交互播放继续读取原媒体；列表和普通 `next/image` 场景只展示静态缩略图。
- 视频封面生成失败或尚未完成时只显示占位图，不在用户请求链路中启动 FFmpeg。

## 4. 部署边界

当前媒体相关部署组件只有 App、Worker、ImgProxy 和外部 Traefik：

- App 读取原媒体并读写派生媒体；是否允许修改原媒体由挂载模式决定。
- Worker 读写原媒体和派生媒体，执行 FFmpeg/FFprobe 任务。
- ImgProxy 只读挂载原媒体和派生媒体。
- Traefik 只需保留现有 ImgProxy 图片路由，不再配置 `/_video` Thumbor 路由。

从旧版本升级时，应先发布并验证新 App/Worker 的静态封面、缺失封面占位和原视频播放，再停止、删除旧
Thumbor 容器以及外部 `/_video` 路由。回滚到仍依赖 Thumbor 的旧版本时，必须使用该版本归档的
Compose 和路由配置，不能与当前 Compose 混用。
