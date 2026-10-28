---
status: accepted
scope: Android 优先的独立 Flutter 阅读客户端与服务端复用
last-verified: 2026-10-28
sources:
  - packages/pixishelf-app/pubspec.yaml
  - packages/pixishelf/lib/mobile/auth.ts
  - packages/pixishelf/services/mobile-reader-service.ts
---

# 0009：以独立 Flutter 包验证 Android 沉浸阅读

用户希望摆脱浏览器导航栏占用，把沉浸看图作为 App 的主要收益，同时保持网页管理体验与主线开发稳定。

选择在 `packages/pixishelf-app` 新建 Flutter 包，先交付自用 Android APK。服务端只增加版本化 HTTP/JSON 适配层，复用 Next.js 领域服务与已有数据库；不重新实现阅读、评分或媒体身份。Web Cookie 与移动 Bearer 使用不同认证入口，移动端不依赖浏览器 Cookie 注入、不使用 WebView 承载阅读器。

PWA 成本更低，但不足以验证原生系统栏、手势和媒体生命周期收益；WebView 可复用页面，却难以区分 App 收益与浏览器壳差异；完整重写后台则超出验证目标。因此本次保留 Next.js 服务端与网页，移动包只做阅读与轻量喜欢。视频与 APNG 纳入同一验证范围；复杂管理和离线能力留待价值验证之后。

代价是需要维护 Dart DTO、HTTP 契约、原生播放器兼容和独立移动构建环境；APNG 独立解码需要内存与帧合成测试。Android 采用系统播放器支持的编码，不引入服务器转码。当前 APK 使用开发签名，正式分发、签名和版本升级另行决定。

本决策不改变单信任域、媒体身份、个人阅读／评分与数据恢复规则，不承诺 iOS 或鸿蒙支持。当前行为维护在[功能规格](../features/android-app.md)，验收证据不在 ADR 追加。
