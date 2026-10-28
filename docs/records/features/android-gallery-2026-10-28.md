---
status: historical
scope: Android 图库首页与作品内选图的隔离验证
last-verified: 2026-10-28
sources:
  - packages/pixishelf-app/lib/gallery_view.dart
  - packages/pixishelf-app/lib/media_grid_sheet.dart
  - packages/pixishelf-app/test/gallery_view_test.dart
  - packages/pixishelf-app/integration_test/gallery_test.dart
  - packages/pixishelf/lib/mobile/__tests__/feed.test.ts
---

# Android 图库与作品内选图：2026-10-28

适用 `codex/android-flutter-prototype` 独立工作区，基线 `912f7e73`。本轮是在已安装的 Flutter 预览版上增加图库首页和作品内缩略图导航，未合并主线、未部署业务服务。行为与未移植范围统一见[Android 规格](../../features/android-app.md)。

## 对齐依据

核对 H5 `app/artworks/page.tsx`、`components/artwork/artwork-card.tsx`、共享筛选 Schema 和作品查询服务，以及[列表稳定性](../../features/artwork-search-and-favorites.md#本轮列表稳定性)。相关 H5 源码与本机主干对比无差异。当前浏览器会话停留在登录页，未读取密码或进入真实收藏；布局与交互以源码为依据，不声称已完成真实 H5 账户的逐页视觉对照。

## 环境与数据

Flutter 3.27.3、Dart 3.6.1；原生流程使用专用 Android API 35 模拟器与测试目录内的合成身份、颜色图片。正常 App 仍要求登录，没有添加免登录入口。服务端测试使用 mock／临时目录，不连接业务数据库。保留主线正在运行的 5430 服务，不执行迁移或启动另一组业务服务。

## 检查结果

- Flutter `analyze` 无问题，24 项单元／组件测试通过，包括筛选草稿取消／应用、账户隔离、旧请求迟到、网格返回位置、跨媒体分页选图、缩略图不记阅读，以及 320×640、1.3 倍字体和键盘显示场景。
- Android API 35 模拟器的图库原生流程通过：进入图库、打开／取消筛选、进入作品、打开缩略图、滚动并选到第 31 项、返回原图库；共享 API 仍可用且列表没有重新请求。已检查首页、筛选、选图三张截图。测试使用进程级 `NO_PROXY=localhost,127.0.0.1,::1`、`--no-dds` 和 `--no-enable-impeller`；初次调试连接被本机 HTTP 代理干扰，配置回环绕过后重跑通过。
- 移动接口和复用作品查询的聚焦测试 60 项通过，覆盖筛选参数、游标、会话归属、缩略图认证、512px 静态派生、版本冲突与无可用封面。
- 网页 `pnpm lint` 通过。最终 `pnpm test`：461 文件通过、48 文件跳过；3366 项通过、326 项跳过。跳过项依赖未配置的隔离 PostgreSQL 等环境，不作为通过证据。
- 首次网页全量运行有一项既有任务管理时序用例失败：`maintenance-card-live-events.test.tsx` 的初始查询期间生命周期事件协调用例。该文件单独重跑 5 项通过；关闭本任务模拟器后，全量再次运行全部通过。未修改该模块、测试或断言。

- Next.js 生产构建成功；本隔离工作区没有配置业务 `DATABASE_URL` 与 `BETTER_AUTH_SECRET`，构建时出现相应环境提示，不据此声称真实登录或数据链路通过。最终独立 `pnpm typecheck` 通过；新增测试的可空数组访问与 Response Buffer 类型已修正，对应 12 项测试重跑通过。
- 正常 `lib/main.dart` 入口的三个 ABI release APK 构建成功。arm64 包已保留数据覆盖安装至 NOH_AN01 实体手机，启动返回 `Status: ok`；包版本为 `0.2.0`、versionCode `2002`，进程正常运行。
- 文档链接、锚点和围栏检查通过；使用 `WEBP_BROWSER_CHANNEL=chrome` 的图示检查通过，33 份图源及 23 段内嵌 Mermaid 一致。主应用路径大小写和 `git diff --check` 检查通过。

主要 APK：`packages/pixishelf-app/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`，19,322,770 bytes；SHA-256：`dcc69b4f7653a0ddd32a8f9d35eaed3342bcdd632397866795a4e7d10ed03242`。产物不纳入 Git；重建后的文件应以新哈希为准。正常 release 包仍使用开发签名。

本机临时证据：`/private/tmp/pixishelf-gallery-web-tests-final.log`、`/private/tmp/pixishelf-gallery-web-build.log`、`/private/tmp/pixishelf-gallery-typecheck-final.log`、`/private/tmp/pixishelf-gallery-flutter-tests.log`、`/private/tmp/pixishelf-gallery-native.log`、`/private/tmp/pixishelf-gallery-release-build.log`。三张测试截图位于 `/private/tmp/pixishelf-gallery-screenshots/`，不作为长期生产发布凭据。

## 未覆盖范围

未执行真实 HTTPS 登录、真实收藏封面链路、实体手机图库性能或与主干运行实例的联调。测试截图中的颜色图块为合成媒体，不是用户收藏，也不进入正常 APK。
