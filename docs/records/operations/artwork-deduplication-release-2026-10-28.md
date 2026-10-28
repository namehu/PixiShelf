---
status: historical
scope: 去重 F03 第七批的 v0.54.17 镜像发布与 NAS 交接，不代表生产已升级
last-verified: 2026-10-28
sources:
  - docs/features/artwork-deduplication.md
  - docs/records/artwork-deduplication-budget-continue-f03-2026-10-28.md
  - .github/workflows/build-and-deploy.yml
  - docs/operations/runbooks/artwork-deduplication.md
---

# 去重 F03 第七批发布交接

已发布版本为 `v0.54.17`，基于已发布的 `v0.54.15`（`2ad7b40a`）。用户自行更新 NAS；本轮只整理主线、发布标签及镜像，不连接生产，也不更新主目录的开发数据库或服务。

## 发布范围与分支隔离

- 纳入 `e26b43fa` 文档整理及 `721927c8` 比较分轮继续：检查累计达到单轮 20 万次比较且仍有待处理内容时，保存进度、等待用户点击“继续检查”。普通暂停、Worker 重启与重新领取不会自行增加轮次。
- 1 万登记原件等公开结构性上限保持不变。当前未完成的结果仍不能进入审核和删除，已完成的既有结果不受替代。
- 独立发布 worktree 从远端 `main` 快进合入上述两个提交。主目录继续停留在 `codex/android-local-validation`；Android 功能提交不进入本次发布，其文件和暂存区不参与合并。
- Android 开发者提交自己的工作后，可在 Android 分支执行 `git fetch origin`、`git merge origin/main`。如文档交叉修改出现冲突，按双方最新内容整合；不以覆盖一方目录解决。

## 验收依据

复用[第七批验收](../artwork-deduplication-budget-continue-f03-2026-10-28.md)、[独立审查](../artwork-deduplication-budget-continue-f03-review-2026-10-28.md)和[实际浏览器记录](../artwork-deduplication-budget-continue-f03-browser-2026-10-28.md)：

- 77 项不同后端测试、30 项界面测试通过；空库 127 项迁移及已有 126 项迁移的非空库升级通过，旧 v5 数据保留。
- 隔离 App/Worker、1,600 张合成 PNG 的浏览器检查实际达到 20 万次后暂停；刷新和 Worker 正常退出再启动仍保持等待；一次继续后完成 24 万次。没有执行删除，作品与文件保留。
- 已完成受影响链的类型检查、定向 lint、一次 Worker 构建及文档/图示检查。本轮不重复本地全量 lint、test、build；发布标签按既有远端 CI 和镜像门禁验证，不跳过门禁。
- 该浏览器样本使用已准备的视觉特征，不能作为真实图片解码、NAS 并发性能或生产识别率的证据。真实原图冷/热检查、50 万当前算法及生产观察仍见[后续计划](../../design/artwork-deduplication/matching-extension.md)。

## 发布状态

首个标签 `v0.54.16` 指向 `8e38740d2c9517035dc6b7ec1b208e91fb6706e7`。[该标签 CI](https://github.com/namehu/PixiShelf/actions/runs/40658029140) 的 WebP job 在安装浏览器时失败：`ubuntu-latest` 实际使用 Ubuntu 26.04，当前 Playwright 1.56.1 不支持该系统；此前 WebP 类型检查、49 项测试、6 项预编译测试及构建均已通过。此标签不作为交付部署版本，即使独立镜像工作流生成了 Release，也不能代替 CI 成功。

最小修复只将 CI 的 WebP job 固定到兼容的 Ubuntu 24.04，不移除验证步骤，不更改产品代码或依赖。GPT-6.1 Sol / xhigh 实施与另一独立 Sol / xhigh 审查已确认：锁定依赖明确支持该系统，CI 逐字差异只有 runner 值，全部测试及汇总门禁保留；YAML 静态检查与 308 篇文档检查通过，无阻塞项，未重复本地全量验证。为保留标签不可变性，改发 `v0.54.17`；此版本已完成下述最终核验。

标签 `v0.54.17` 指向 `efc20243214d098e85cf3fe54bbc932ad3bded84`。同提交的 [CI](https://github.com/namehu/PixiShelf/actions/runs/40658979746) 和 [Build and Deploy](https://github.com/namehu/PixiShelf/actions/runs/40658979791) 均在首次运行完成并返回 `success`，没有跳过门禁或重跑全量工作流。对比 `721927c8`，本次发布收口未改变任何产品、构建资源或依赖锁文件；只有 CI runner 及发布说明变化。

[GitHub Release](https://github.com/namehu/PixiShelf/releases/tag/v0.54.17) 于 2026-10-28 16:52:20（Asia/Shanghai）生成，附 `docker-compose.deploy.yml`、`default.env.example`、`init.sql`、`DEPLOYMENT.md`。验证结果：

- 正式迁移 127 项全部成功，数据库状态为最新；Worker 依赖链类型检查、测试和构建成功，初始版本检测／审核 60 项及删除 8 项专项通过。
- Web lint、typecheck、3,392 项测试及生产构建成功，263 项按既有条件跳过。WebP 类型检查、49 项单测、6 项预编译测试、70 项实际浏览器测试和构建成功。
- 发布门禁的 contracts 172、DB 284、runtime 109、executors 1,095、Worker 126 项测试通过；条件跳过不计为通过，隔离专项升级与分轮证据仍以前述第七批记录为准。
- 镜像发布、安全扫描及计时作业成功。安全扫描作业成功不代表没有已报告漏洞。

只读读取两个仓库的版本 manifest，校验响应 digest 与实际字节 SHA-256，并确认两仓库一致：

| 镜像 | GHCR 与 Docker Hub 共同的 `v0.54.17` OCI index digest |
| --- | --- |
| `pixishelf` | `sha256:f9132a62dac4f3547e869a3faf967d2ca524b4633240a66335178fd51100f4c8` |
| `pixishelf-worker` | `sha256:b0085ecb2c4da6cbdb6139a7d5c0ce75b4b1bf4c12ada148f4e61f058865d7a3` |

两份镜像的运行架构均为 `linux/amd64`，index 另含构建证明。原始核验摘要保存于本机 `/private/tmp/pixishelf-dedup-release-20261028/image-digests.json`；以上工作流链接与 digest 为持久证据。

发布期间 Android 分支自行从 `64494e4c` 推进至 `f5c4cc1f`，主目录当前干净。这是并行开发产生的变化：本次没有在主目录切分支、暂存、提交、重置或覆盖文件；发布准备前后的分支、index 和差异摘要保留于同一临时证据目录。没有把并行变化误写为工作区字节完全未变。

发布交接的 `docs:check` 通过（308 篇），主应用路径大小写检查与差异空白检查通过。图源和 SVG 相对已验收的 `721927c8` 无差异，沿用第七批的 34 个图源／23 个嵌入块检查证据，没有重新渲染。

## NAS 升级交接

App 与 Worker 统一使用 `v0.54.17`，运行平台为 `linux/amd64`。标准 Compose 镜像为 `dockernamehu/pixishelf:v0.54.17`、`dockernamehu/pixishelf-worker:v0.54.17`；GHCR 对应 `ghcr.io/namehu/pixishelf:v0.54.17` 和 `ghcr.io/namehu/pixishelf-worker:v0.54.17`。

从 `v0.54.15` 升级新增 **`20261028000100_artwork_dedup_visual_rounds`**：添加轮次、轮次起点和等待继续三个字段，默认 `0/0/false`。迁移不读取媒体，也不改写旧检测结论。新扫描使用 v6，维护仍使用 v5，旧扫描 v5 继续兼容。

按[标准发布步骤](../../operations/deployment.md#标准发布)和[去重升级手册](../../operations/runbooks/artwork-deduplication.md)操作：

1. 停止调度和外部写入，等待活动任务收口；停旧 App/Worker，按[备份基线](../../operations/backup-and-recovery.md#发布前一致性检查点)核对一致性检查点。
2. 将实际 Compose 使用的 `IMAGE_TAG` 设为 `v0.54.17`，拉取配套 App/Worker 镜像。使用目标 App 镜像执行正式 `prisma migrate deploy`，不得使用 `db:push`。
3. 先启动 Worker，核对 READY 和 capability 支持扫描 v6；再启动 App，恢复原本启用的调度及外部写入。
4. 先选小艺术家检查、刷新和暂停/继续，观察是否仍可浏览作品。达到单轮比较上限后应显示等待继续；继续前后保持同一任务。

存在活动 v6 任务时，不得直接回退到不理解 v6 的 Worker。需要回退时保留新增字段、约束、检查点和兼容执行器，不手改任务版本或等待标记。删除过的原件不能靠换镜像恢复。

生产实际镜像、迁移与观察结果等待用户更新 NAS 后登记。
