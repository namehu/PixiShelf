---
status: historical
scope: Android 分支合入主工作目录、Worker 重启及 USB 本地联调准备
last-verified: 2026-10-28
sources:
  - packages/pixishelf-app/lib/api.dart
  - packages/pixishelf-app/android/app/src/debug/AndroidManifest.xml
  - packages/pixishelf-app/test/api_test.dart
  - build/docker-compose.dev.yml
---

# Android 主工作区本地联调准备

用户授权将独立工作区的 App 代码合回主目录，在主目录另开分支，并重启必要的 Worker；Next.js 由用户 F5 启动。本次准备未读取账户密码、创建测试账户、扫描收藏或修改作品。

## 合并与恢复依据

主目录 `/Users/namehu/mm_code/PixiShelf` 开始为干净的 `main`，提交 `2ad7b40a`。在此基础上创建 `codex/android-local-validation`，通过合并提交 `20f687b6` 纳入原型提交 `724ac9af`；无冲突，原有 F03 更新全部保留，`main` 引用保持原值。未推送或部署到 NAS。原型验证证据见[图库记录](../features/android-gallery-2026-10-28.md)。

App 无数据库结构、Worker、Compose 或媒体写入格式变更，本次没有执行迁移、db:push、清库、重建数据库或覆盖媒体。恢复依据为合并前的主线提交、独立原型提交和保留的相同 Worker 镜像；无需恢复数据库来撤销本次代码接入。原有数据库和媒体检查点仍见[F03 本地升级记录](./artwork-deduplication-f03-b56-local-upgrade-2026-10-28.md)，不把该历史检查点冒充本次新备份。

## 基础服务

重启前只读检查开发队列：115 项 COMPLETED、8 项 FAILED、2 项 CANCELLED；没有运行中或待处理任务，迁移失败数为 0。仅执行现有 Worker 的 45 秒优雅重启，镜像保持 `sha256:6c8f5bb6df5916519b7819cb5d2c2895cea72e5c8bf21321b891570c605d4dae`，未重新构建。

首次紧跟 restart 的 READY 请求早于健康端口就绪而连接被拒；随后复查成功。最终 Worker 为 healthy，能力审计通过：1 个 READY Worker、39 类任务／55 个版本。PostgreSQL 保持 healthy，ImgProxy `/health` 返回 200；这两项没有重启。未启动 scheduler、额外 Worker 或 Next.js，最后检查宿主 5430 未监听，等待用户 F5 启动。

## USB 调试构建

新增显式 Debug 编译开关，预填回环地址并保留正常登录；具体边界与命令统一见[安全边界](../../security/access-control.md#移动客户端接口)及[包说明](../../../packages/pixishelf-app/README.md#usb-本地联调)。ADB reverse 已将设备 5430 转发到宿主 5430。该路径只验证 USB 本地开发，不代表 HTTPS 部署、局域网连接或生产反向代理已验收。

正常 `lib/main.dart` 入口的 arm64 Debug APK 构建成功，版本 `0.2.1`、versionCode `2003`；APK 为 86,887,982 bytes，SHA-256 `ceb1461df7f2e7da7dc2bf4e2196239906451af1ef2f6746201065bae1706b45`。解析产物 Manifest 确认 Debug 网络配置只允许 `127.0.0.1` 明文，默认仍禁止明文。已经保留数据覆盖安装至 NOH_AN01 手机，启动返回 `Status: ok`，安装版本和进程再次核对正常；不包含合成图库入口。截图时设备处于 Asleep，未解锁设备，不声称本次已完成真机登录页视觉复核。

## 验证与限制

- 合并后的主工作区 `pnpm lint`、`pnpm exec tsc --noEmit` 和 60 项移动接口／作品查询测试通过。之前的全量网页测试与生产构建见原型记录；本次未在用户 F5 目录再次执行生产构建。
- Flutter analyze 通过，普通模式和显式 USB 模式分别 25 项测试通过。USB 模式首次发现登录测试依赖空地址；改为显式输入非法局域网地址，并增加预填地址校验后通过，两种模式均未放宽拒绝断言。
- 主目录文档链接检查及 Chrome 图示检查通过；33 份图源、23 段内嵌 Mermaid 有效，路径大小写与 diff 空白检查通过。
- 尚未完成真实账号登录、本地图片／视频／APNG 展示、进度写回或主环境性能验证；本次只完成代码和连接准备。用户启动 F5 并登录后再核对这些链路。

日志位于 `/private/tmp/pixishelf-android-main-tests.log`、`/private/tmp/pixishelf-android-local-worker-capabilities.log`、`/private/tmp/pixishelf-android-local-flutter-tests.log`、`/private/tmp/pixishelf-android-usb-flutter-tests.log` 和 `/private/tmp/pixishelf-android-usb-build.log`。临时日志与 APK 不纳入 Git，不作为生产发布证明。
