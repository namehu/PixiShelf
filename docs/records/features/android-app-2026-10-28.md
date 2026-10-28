---
status: historical
scope: Android Flutter 首轮验证，含视频和 APNG；独立工作区本地证据
last-verified: 2026-10-28
sources:
  - packages/pixishelf-app/test/
  - packages/pixishelf-app/integration_test/native_media_test.dart
  - packages/pixishelf/lib/mobile/__tests__/
  - packages/pixishelf/tests/integration/security-next.test.ts
---

# Android 验证版：2026-10-28

适用基线 `912f7e73`，分支 `codex/android-flutter-prototype` 的本次工作区内容；尚未合并、部署或登记发布提交。功能规则见[Android 规格](../../features/android-app.md)。

## 环境与样本

macOS arm64，Flutter 3.27.3、Dart 3.6.1，Android API 35 模拟器；安装与浅色登录界面检查使用 NOH_AN01 实体手机（Android API 31、arm64）。服务端依赖从锁文件安装；Prisma 只执行 generate，没有迁移、db:push 或生产数据操作。媒体服务使用临时目录的合成字节；APNG 使用生成的颜色／局部透明帧，视频使用 FFmpeg 生成的 8 秒 320×180 H.264 测试图。没有读取私人收藏、真实账户密码或服务环境文件。

## 检查结果

- 原网页 `pnpm lint`、`pnpm typecheck` 通过。第一次并行 typecheck/build 因 `.next/types` 目录被重建而失败，改为先完成 build 再独立 typecheck 后通过；不是代码类型错误。
- 原网页 `pnpm test`：460 文件通过、48 跳过；3357 项通过、326 跳过。跳过项未配置隔离 PostgreSQL 等必要环境，不属于本轮通过证据。
- 最后聚焦移动接口、原 proxy 和真实生产 Next 安全 fixture：62 项通过，覆盖 Cookie/Bearer 入口隔离、未授权零业务写入、账户前置条件、错误脱敏、范围读取、APNG 原件、路径越界与维护副本。fixture 补齐原有删除路由已引用但测试环境未复制的 Schema；原路由实现未改。
- Flutter analyze 无问题；18 项单元／组件测试通过，覆盖实际横／纵翻页、缩放锁页、隐藏浮层、原地址边界、APNG 帧／处置／循环与独立海报、阅读观察和喜欢失败恢复。界面修订增加 320×640、1.3 倍字体及键盘占用 280px 时的登录滚动、密码显隐和错误显示验证，并验证阅读器深色与设置浅色的主题边界。
- Android API 35 原生测试 3 项通过：系统状态栏／导航栏实际隐藏和恢复；APNG 实际换帧、暂停、缩放不重载；视频播放、seek、静音切换、遮挡暂停和恢复。前几轮遇到 ADB／VM Service 断连，改用独立 emulator 5590／ADB 5038 后稳定完成；测试使用 `--no-enable-impeller`。修正了测试异步回调中调用 guarded expect 的用法后通过，没有跳过断言。
- 正常 `lib/main.dart` 入口的 debug APK 以及按 ABI 拆分的 release APK 均构建成功。Debug 包在模拟器安装、启动到中文登录界面，正常启动使用默认 Impeller；优化后的 arm64 release 包也已安装并启动至登录界面，作为主要交付物，仍为开发签名自用预览包。
- Next.js 最终生产 build 成功。文档链接检查通过；图源和 SVG 经本机 Chrome 重渲染并检查，33 份图源及 23 段内嵌 Mermaid 通过。默认 Playwright bundled Chromium 未安装，验证显式设置 `WEBP_BROWSER_CHANNEL=chrome`。
- 浅色界面修订后的 arm64 release 包已通过 `adb install -r` 覆盖安装至实体手机并冷启动成功，保留现有 App 数据；真机截图确认登录表单完整可见、系统状态栏图标对比正常。主要文字／次要文字／占位文字／主按钮文字对比度分别为 12.46、4.77、5.04、5.23:1。真实图库中的设置和媒体观看效果仍待联调，本轮设置主题由组件测试验证。
- 主线工作区复核无改动。本次修改只留在独立工作区，没有合并主线或修改现有数据库。

主要 APK：`packages/pixishelf-app/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`，18,732,196 bytes；SHA-256：`63f2bdd02bf1076cafda266740b7d77488d7d84297cd7b01f73d501d410a31b2`。产物不纳入 Git，重建后以新哈希为准。

## 证据位置与限制

当前本机日志位于 `/private/tmp/pixishelf-mobile-web-tests.log`、`/private/tmp/pixishelf-mobile-web-build.log`、`/private/tmp/pixishelf-mobile-flutter-tests.log`、`/private/tmp/pixishelf-native-media-tests.log`、`/private/tmp/pixishelf-mobile-release-build.log`；浅色登录页真机截图位于 `/private/tmp/pixishelf-phone-light.png`。临时日志和截图不作为长期生产发布凭据。用包级 README 和测试文件可重跑。

未执行真实 HTTPS Better Auth 登录／退出、跨端真实数据库进度同步、生产反向代理 Range、实体手机的长时间浏览／发热／大图性能与编码兼容验收。安全 fixture 使用合成身份，不能证明真实签名会话和生产代理正确配置。原生视频测试使用临时文件，HTTP Range 由服务端独立文件流测试覆盖，二者不等于完整远端播放链路已验收。

没有数据库 Schema 或持久文件写入格式变化；移除本功能不需结构迁移。通过 App 产生的合法会话、阅读和评分应保留为现有领域数据；若需部署或恢复，仍遵循[备份与恢复](../../operations/backup-and-recovery.md)，不能删除这些记录来模拟回退。
