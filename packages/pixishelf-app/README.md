# PixiShelf Android Preview

独立 Flutter 包。范围、状态与限制见[功能规格](../../docs/features/android-app.md)，HTTP 契约见 [OpenAPI](../../docs/api/mobile-v1.openapi.json)，验证证据见[首轮记录](../../docs/records/features/android-app-2026-10-28.md)和[图库迭代记录](../../docs/records/features/android-gallery-2026-10-28.md)。不通过 pnpm 构建，不修改现有网页页面。

## 运行

本轮使用 Flutter 3.27.3 / Dart 3.6.1，Android minSdk 23。先安装 Flutter 和 Android SDK，保留 `pubspec.lock`，在本目录执行：

```sh
flutter pub get
flutter analyze
flutter test
flutter run -d <android-device-id>
```

输入已运行本分支服务端的 HTTPS 根地址，例如 `https://gallery.example.com`，再使用已有账户登录。服务器需要有效系统信任证书，并让反向代理保留 Authorization 和 Range；不关闭 TLS 校验，不把明文 HTTP 作为 APK 入口。原有未包含移动接口的服务端无法直接连接此 APK。后端启动遵循[根说明](../../README.md)，不要在仓库根运行 pnpm dev，不使用 db:push。

构建用于手机体验的优化 APK：

```sh
flutter build apk --release --split-per-abi
# build/app/outputs/flutter-apk/app-arm64-v8a-release.apk（常见 arm64 手机）
# 同目录另有 armeabi-v7a、x86_64 包
```

此版本沿用 Flutter 开发签名，仅作自用验证，不是商店分发配置。Release 使用优化编译，但目前仍用开发签名；正式分发前配置自己的签名与更新策略。需要调试时可运行 `flutter build apk --debug`。构建、设备配置和凭据不要提交。

## USB 本地联调

在已合入移动接口的主工作区，用原 F5 配置启动 Next.js。手机打开 USB 调试并授权电脑，在本包目录构建和安装正常登录入口：

```sh
flutter build apk --debug --split-per-abi --target-platform android-arm64 --dart-define=PIXISHELF_USB_DEV=true
adb -s <device-id> install -r build/app/outputs/flutter-apk/app-arm64-v8a-debug.apk
adb -s <device-id> reverse tcp:5430 tcp:5430
```

该构建会预填服务器 `http://127.0.0.1:5430` 并标注 USB 本地调试；使用原 PixiShelf 用户名和密码。无需给手机复制收藏文件，仍由电脑读取本地媒体。请保持 USB 连接；重连后必要时重跑 `adb reverse`，结束后可执行 `adb -s <device-id> reverse --remove tcp:5430`。Debug 包用于功能联调，性能和发热结论应使用优化构建另测。

普通构建和 Release 继续只接受 HTTPS，具体限制见[移动接口安全边界](../../docs/security/access-control.md#移动客户端接口)。本地例外测试分别运行 `flutter test` 和 `flutter test --dart-define=PIXISHELF_USB_DEV=true`；不使用免登录模式。

## 图库与选图验证

登录后进入作品网格；布局和已支持筛选的语义对齐 H5，封面进入阅读器，页码打开作品内选图。功能范围与未移植项统一见[Android 规格](../../docs/features/android-app.md)。正常 APK 没有免登录或演示入口。

新流程原生验证只在专用模拟器执行，使用测试目录的合成身份／媒体，不连接业务实例。截图默认保存到 `build/gallery-screenshots`：

```sh
flutter drive --driver=test_driver/gallery.dart --target=integration_test/gallery_test.dart -d <emulator-id> --no-enable-impeller
```

若本机设置了 HTTP 代理，调试连接需通过进程级 `NO_PROXY=localhost,127.0.0.1,::1` 绕过代理。测试入口不能安装到存有真实账户数据的手机；对外安装前必须重新构建正常 `lib/main.dart` 入口。

## 原生媒体自动验证

测试只使用生成图形和临时视频，不读取收藏目录。运行前使用本机 FFmpeg 生成 8 秒 H.264 测试图，并将它作为编译常量传给仅测试入口；该视频不进入正常 APK：

```sh
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=24 -t 8 -c:v libx264 -pix_fmt yuv420p -movflags +faststart /tmp/pixishelf-smoke.mp4
python3 - <<'PYTHON'
import base64, json
from pathlib import Path
Path('/tmp/pixishelf-smoke-defines.json').write_text(json.dumps({
    'SMOKE_VIDEO_BASE64': base64.b64encode(Path('/tmp/pixishelf-smoke.mp4').read_bytes()).decode()
}))
PYTHON
flutter test integration_test/native_media_test.dart -d <android-device-id> --dart-define-from-file=/tmp/pixishelf-smoke-defines.json
```

软件渲染的 Android 模拟器如遇 Impeller 驱动断连，可在测试命令加 `--no-enable-impeller`。测试验证 Android 系统栏隐藏／恢复、真实 APNG 渲染、暂停、缩放不重载，以及原生视频初始化、播放、音量、seek、覆盖暂停／恢复与释放。视频 fixture 使用本地临时文件，不替代真实 HTTPS Range、账户登录和真机编码兼容验收；服务端 Range 另有文件流与安全测试。

测试之后重新执行正常 `flutter build apk --release --split-per-abi`，避免把 integration_test 入口的 APK 当成交付物。
