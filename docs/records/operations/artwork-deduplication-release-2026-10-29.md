---
status: historical
scope: v0.54.19 动图混合媒体修复与删除优化的发布准备及 NAS 交接，不代表镜像已发布或 NAS 已升级
last-verified: 2026-10-29
sources:
  - docs/records/artwork-deduplication-mixed-media-2026-10-29.md
  - docs/records/artwork-deduplication-delete-confirm-2026-10-29.md
  - docs/operations/runbooks/artwork-deduplication.md
  - .github/workflows/build-and-deploy.yml
---

# v0.54.19 发布交接

本轮准备 `v0.54.19` patch tag，并随 main 一起推送。用户自行查看 GitHub 工作流和更新 NAS；按明确要求，不查询 CI、镜像构建或 Release 状态，不记录未经核验的镜像 digest，也不把标签推送等同生产部署完成。

## 合并内容与主线保留

合并前 main 为 `8998d831`，已包含阅读器的短视频读完判断和预览交互修复。去重分支为 `8ac04d45`，共同基线为 `7c45f3c8`；两侧修改文件没有重叠。使用非快进合并提交 `7328a88c21215e17108143d052ca43f4a2ba74a4` 保留双方历史，逐一比较 main 独有的 14 个文件与合并前内容，全部相同。

本次纳入：

- `e711ac79`：视觉检查缓存复用与旧归档删除预览兼容修复，作为本次功能基线一并保留。
- `a6595942`：含动图的作品继续用静图参与视觉比对，动图等明确标为未核对，贯穿检查、图片对照和整部删除确认。
- `8ac04d45`：数据库快速展示确认范围，确认后后台完整核验并删除，减少重复内容读取、逐文件 SQL 和目录检查；正常让槽与故障重新核验区分，安全边界保留。

相对上一个标签 `v0.54.18`，main 原有暂停／取消控制改进及阅读器修复也随本版发布。未覆盖或重置主线文件，未修改锁文件、部署配置、依赖或流水线门禁；发布版号由已有 tag/APP_VERSION 流程提供，不为此改包内固定版本。

本轮只合并及准备发布，不重启主目录服务，不迁移开发库，不连接 NAS 或操作生产数据。

## 已有验收与本次检查

复用[混合媒体验收](../artwork-deduplication-mixed-media-2026-10-29.md)和[快速确认验收](../artwork-deduplication-delete-confirm-2026-10-29.md)：独立代码审查、针对测试、正式空库及非空升级、桌面检查／确认／实际删除均有证据。删除测试只移除合成 B，A/C 原件哈希不变。新维护使用 v6，扫描使用 v7，旧任务维持原版本语义。

本机同一批 400 原件样本：确认等待 4.87 秒降至 0.36 秒，总处理 16.70 秒降至 9.47 秒；混合媒体完整读取量减半。单次本机合成结果不能外推生产 NAS 耗时或此前 147 秒案例。

本轮无冲突、无额外功能修改，只检查祖先关系、主线文件保留、合并差异空白、主应用路径和发布文档链接；图源及 SVG 原样复用已验收版本。没有重复全量 lint/test/build，不跳过既有远端门禁。用户自行查看 tag 对应工作流的最终结果后使用目标镜像。

另保留一项尚未定位的开发模式观察：隔离 App 日志曾出现 `TypeError: controller[kState].transformAlgorithm is not a function`，实际浏览器删除与存活文件验证仍成功；没有证明该日志与本轮改动相关，也没有复现生产缺陷。本次按要求不重新开启完整环境调查，不能据此宣称生产日志完全无异常。

## NAS 升级要点

App 和 Worker 配套使用 `v0.54.19`，不要混用不同版本。沿用现有 `linux/amd64` 镜像：

- `dockernamehu/pixishelf:v0.54.19`
- `dockernamehu/pixishelf-worker:v0.54.19`

GHCR 对应 `ghcr.io/namehu/pixishelf:v0.54.19` 与 `ghcr.io/namehu/pixishelf-worker:v0.54.19`。这些是目标标签，不表示本记录已经核实其存在或构建成功。

相对 v0.54.18 新增两个正式迁移：

1. `20261029000100_artwork_dedup_mixed_visual`：混合媒体证据与扫描 v7 约束。
2. `20261029000200_artwork_dedup_quick_confirmation`：准备版本、核验进度、续行许可、不可变文件核验依据及维护 v6 约束。

迁移不扫描媒体、不删除既有作品，旧操作默认准备版本 1。新旧任务兼容不等于可以让旧 Worker 执行新协议。

按[标准发布](../../operations/deployment.md#标准发布)与[去重升级手册](../../operations/runbooks/artwork-deduplication.md)操作：停写并保留数据库和媒体同点备份；拉取配套目标镜像，用目标 App 镜像正式执行 migrate deploy；先启动 Worker 并核对 READY、扫描 v7／维护 v6 能力，再开放 App。不要使用 db:push。含动图的旧检查需重新检查才获得新的静图覆盖；旧删除操作仍维持旧准备流程，新建操作才使用快速确认。

存在活动新任务／删除操作时，不得直接降级到不理解该协议的旧 Worker，也不要手改任务版本或删除证据。保留原 App/Worker 镜像及[一致性恢复依据](../../operations/backup-and-recovery.md#发布前一致性检查点)。本次没有替用户创建生产备份；实际生产镜像、迁移与使用结果由 NAS 更新后另行登记。
