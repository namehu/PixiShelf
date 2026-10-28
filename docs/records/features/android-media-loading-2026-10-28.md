---
status: historical
scope: Android 0.2.3 图片持续加载与原生崩溃修复，含测试手机复核
last-verified: 2026-10-28
sources:
  - packages/pixishelf-app/lib/api.dart
  - packages/pixishelf-app/lib/media_canvas.dart
  - packages/pixishelf-app/test/media_download_test.dart
  - packages/pixishelf-app/integration_test/static_media_test.dart
---

# Android 图片加载与崩溃修复

用户在主环境发现作品内图片持续转圈、偶发崩溃及列表封面显示慢，并要求 GPT-6.1-sol 检查测试手机。本轮由该子智能体负责真机复现、原生堆栈符号化与复核，主智能体负责代码和自动回归；工作留在主目录 `codex/android-local-validation` 分支，起点 `ea744bc9`。

## 根因与对照

1. `MobileApi.media` 的 `whenComplete(() => _pending.remove(url))` 返回了 Map 中的同一个 Future，造成返回链等待自身。真实 HTTP profile 显示封面与大图均返回 200，媒体响应约 65–121ms，reader 与媒体页约 105ms／55ms；数据已接收，但调用者一直收不到完成结果。只修解码后的 0.2.2 仍可复现超过一分钟的转圈；同包切换 Skia 也没有解决。最终把清理回调改为不返回值的语句块。
2. 缓存命中绕过未完成 Future 后，会进入另一处风险：`MediaCanvas` 在首帧异步解码前释放 `ImageDescriptor`。0.2.1 真机记录两次 native SIGSEGV（14:30:40、14:33:18），发生在 `io.worker`；与安装引擎完全匹配的符号定位到 `SkData::size`／`SkMallocPixelRef::MakeWithData`、`ImageDecoderImpeller::DecompressTexture`。改为项目 Flutter 3.27.3 提供的 `instantiateImageCodecWithSize` 管理解码描述符生命周期，保留原尺寸和像素上限。

没有更换渲染器、升级 Flutter、降低图像质量或修改服务端缓存／限流。本轮最初考虑的队列优化在 HTTP 证据明确后撤下，未进入手机最终版本。图片仍只通过网络传到内存供显示，未新增相册保存、离线下载或磁盘图片缓存。

## 回归范围

- Flutter analyze 通过；普通模式和 USB 模式分别 28 项单元／组件测试通过。
- 新增真实 `MobileApi` + Dio adapter 测试，覆盖首次响应正常完成、并发请求共享、缓存命中、503 失败完成与重试、两槽并发释放后继续排队请求。原有图库 fixture 覆写了媒体方法，未覆盖该 Future 链；本次补齐此缺口。
- 新增独立 Android 原生静态媒体用例并通过，使用合成 JPEG／PNG／WebP，走真实 `MobileApi` 完成链和 `MediaCanvas`，检查首帧、缩放与连续替换。测试在 API 35 专用模拟器使用软件渲染及 `--no-enable-impeller` 运行，完成后关闭模拟器；不覆盖用户手机的登录数据。
- 真机保持默认 Impeller（Vulkan），0.2.3 已确认首屏封面和作品正文正常显示，连续翻到 9/10，前后翻图、双击放大、恢复适应屏幕、返回列表、重新进入恢复 4/10 以及打开相邻作品均通过。14:49:38–14:51:55 正常浏览约 2 分 15 秒，无新增 native 或 Dart 异常；退出记录最后一条 native crash 仍是旧版本复现。
- 受控冷启动在 3.37 秒的截图中可见封面已全部显示，这是观测上界，不是帧级性能基准；正文 1.31 秒首截图仍短暂加载，随后正常显示，不声称正文首帧低于 1 秒。最终重启后进程存活，PSS 250,582KB、RSS 315,120KB；此单点数据不构成长时间内存稳定性结论。
- 文档链接、图示、路径大小写及 diff 空白检查通过。网页和服务端未修改，本轮没有重复网页全量构建或重启业务服务。

未修改 Next.js、Worker、数据库或媒体文件，未重启 F5 服务。用户账号与 App 数据通过覆盖安装保留；实际浏览会按既有规则记录阅读进度，没有主动修改作品评分。测试手机之外的兼容性、长时间发热／内存、真实 HTTPS 代理和高延迟网络未在本轮验收。

## 产物与证据

手机正常入口 Debug 包版本 `0.2.3`、versionCode `2005`，86,887,255 bytes；SHA-256：`28e09250c97497ea9c64de4d2b5be8fca08d477d4f93001c8cd5a092c46283b2`。已安装包另保存在本机 `/private/tmp/pixishelf-0.2.3-usb-debug.apk`，避免与模拟器测试入口混淆；临时产物不纳入 Git。

本机脱敏崩溃证据为 `/private/tmp/pixishelf-native-crash-sanitized.log`、`/private/tmp/pixishelf-native-crash-symbolized.log`；Future 最小复现为 `/private/tmp/pixishelf-future-cycle.dart`。自动回归日志为 `/private/tmp/pixishelf-media-fix-tests.log`、`/private/tmp/pixishelf-media-fix-default-tests.log`、`/private/tmp/pixishelf-static-media-native.log`。真机最终摘要为 `/private/tmp/pixishelf-023-device-verification.txt`，截图使用 `/private/tmp/pixishelf-023-*.png`，不包含在仓库中。诊断未输出凭据；临时 HTTP profile 已关闭并清空，临时 ADB forward 已移除，用户本地联调需要的 reverse 5430 保留。
