---
status: historical
scope: v0.54.18 Android 接口与客户端发布交接，不代表 NAS 已升级
last-verified: 2026-10-28
sources:
  - docs/features/android-app.md
  - docs/records/features/android-core-parity-2026-10-28.md
  - .github/workflows/ci.yml
  - .github/workflows/build-and-deploy.yml
---

# Android 对比版发布交接

用户要求合入最新主分支并发布，再自行更新生产环境。目标服务端版本 `v0.54.18`，Android 客户端 `0.3.2+8`。此记录不证明生产 NAS 已更新或生产登录已验证。

## 合并范围

- 以远端主分支 `b1315281` 为基准保留最新去重分轮继续、扫描 v6、迁移与 Ubuntu 24.04 WebP CI 修复；合并提交为 `0e041e30`。
- 唯一冲突是发布记录索引，两侧入口均保留；没有用 Android 分支覆盖主线目录，也没有改动已发布的去重实现、Worker 或迁移。
- 新增 Flutter 包、移动 Bearer 接口与受保护媒体访问；原有 H5 页面不改造。移动端详情、沉浸浏览、视频、APNG、阅读与轻量整理范围见[Android 规格](../../features/android-app.md)。
- 本轮不连接 NAS，不操作生产数据库、媒体、配置或容器；本机 F5 服务与开发数据库不为发布而重启或迁移。

## 本地与发布门禁

合并后主应用 lint、移动 API 67 项测试通过；先前同一移动实现的完整网页回归、构建和 Android 51 项回归见[核心页面记录](../features/android-core-parity-2026-10-28.md)。主线去重迁移与执行器沿用已通过的[上一版发布证据](./artwork-deduplication-release-2026-10-28.md)。本轮发布标签仍需通过相同提交的 CI 汇总及 Build and Deploy，不以本地聚焦测试代替远端 Web／Worker／迁移／WebP 门禁。

Android 生产对比包使用 Release AOT、开发签名，只用于现阶段自用验证；不含 USB HTTP 例外和性能采样。正常入口要求可信 HTTPS 根地址与现有 PixiShelf 账户，不内置服务地址或凭据。当前手机 Profile 包同样支持 HTTPS，可在更多设置中更换服务器。

## 生产交接与恢复依据

App 与 Worker 必须成对使用 `v0.54.18`；镜像构建架构沿用 `linux/amd64`。无需为 Android 新增 secret、环境变量、端口或挂载。保留原 `BETTER_AUTH_SECRET`，HTTPS 证书须由系统信任，反向代理须保留 `Authorization` 与 `Range`。

相对已发布的 `v0.54.17`，此次 Android 功能没有新增 migration。若生产仍低于该版本，需按[上一版交接](./artwork-deduplication-release-2026-10-28.md#nas-升级交接)处理 `20261028000100_artwork_dedup_visual_rounds` 及扫描 v6 能力，使用正式 `migrate deploy`，不使用 `db:push`。

实际 NAS 升级先按[备份基线](../../operations/backup-and-recovery.md#发布前一致性检查点)保留同点检查点及旧 App／Worker 的明确版本或 digest，再按[标准发布](../../operations/deployment.md#标准发布)更新和核验 READY／capability。已有 v6 任务时不能退回不理解 v6 的 Worker。原版本标签和镜像保留；本轮仅发布产物，不声称已建立生产备份或完成生产升级。

生产更新后验证 HTTPS 登录、列表、详情图片、视频 Range、阅读返回和原有 H5。任何生产验证结果应另行登记。
