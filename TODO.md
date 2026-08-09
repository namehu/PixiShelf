# TODO

## 可选媒体格式扩展

- [ ] 评估 AVIF、HEIC、HEIF、JXL 的完整处理链路；当前上传、替换和扫描入口继续拒绝这些格式，后续仅在 Sharp、ImgProxy、MIME 和前端展示全部验证通过后逐项开放。

## 移除 Thumbor 视频截帧服务

状态：待处理

### 背景

视频封面链路已经调整为：

- 使用 FFmpeg 提前生成静态 WebP 封面。
- 使用 ImgProxy 对静态封面进行缩放、格式处理和缓存。
- 静态封面不存在或生成失败时显示占位图，不再实时截帧。
- 作品详情、全屏预览和沉浸浏览继续通过视频播放器加载原始视频。

因此，Thumbor 已经不在正常业务链路中使用。目前仅在 `packages/pixishelf/lib/image-loader.js` 中保留一个兼容兜底：当原始视频路径被直接传给 `next/image` 时，通过 Thumbor 的 `filters:still(1)` 实时截帧。

### 后续清理事项

- [ ] 再次确认所有封面和缩略图入口都使用 `MediaThumbnail`，不存在把原始视频路径传给 `next/image` 的场景。
- [ ] 移除 `image-loader.js` 中的 Thumbor 地址和视频实时截帧分支，并为误传视频路径保留明确的占位或错误处理。
- [ ] 移除 `NEXT_PUBLIC_THUMBOR_VIDEO_URL`、`THUMBOR_HOST_PORT` 及构建时环境变量替换逻辑。
- [ ] 从开发和部署 Docker Compose 中移除 Thumbor 服务、端口、卷挂载及相关路由。
- [ ] 删除 `build/thumbor` 镜像构建配置。
- [ ] 更新 `README.md`、`DEPLOYMENT.md`、架构文档和代理启动说明中的 Thumbor 内容。
- [ ] 停止并删除现有 `thumbor_video` 容器。
- [ ] 回归验证普通图片、静态视频封面、封面缺失占位、视频播放以及 GIF/WebP 处理链路。

### 注意

在代码、环境变量和部署配置清理完成前，不直接永久删除 Thumbor 配置，以免遗留页面触发旧兜底后出现不可定位的图片加载失败。
