---
status: current
scope: GitHub CI、镜像构建发布与原生 WebP 工作流
last-verified: 2026-10-22
sources:
  - .github/workflows/ci.yml
  - .github/workflows/build-and-deploy.yml
  - .github/workflows/webp-native.yml
  - build/Dockerfile
---

# GitHub 工作流

工作流负责检查和发布产物，不会自动部署 NAS。生产更新与恢复见[部署基线](../docs/operations/deployment.md)。

## 工作流入口

| 工作流                  | 触发                              | 结果                                                                |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `CI`                    | Pull request、`v*.*.*` tag、手动  | web/worker/webp 三路独立检查，汇总 `test` 要求三路全部 success      |
| `Build and Deploy`      | `v*.*.*` tag、手动                | 验证与双镜像 OCI 构建并行，门禁后发布；tag 创建 Release/安全扫描    |
| `WebP native artifacts` | 原生/预编译相关路径 push/PR、手动 | 固定工具链复现、sanitizer、产物比较与浏览器校验，不自动修改提交产物 |

三路 CI 的环境与未覆盖项见[测试策略](../docs/development/testing-strategy.md#ci-当前覆盖与缺口)。CI 和镜像发布是独立工作流：发布构建成功不能代替同提交 CI 汇总成功。

## 镜像发布链

1. `validate`：Prisma generate/validate、PostgreSQL 全迁移及 status、Worker 依赖链 typecheck/test/build。执行文件操作测试前，单独运行 `node packages/pixishelf-worker/scripts/build-dedup-native.mjs` 准备原生模块；不通过提前构建全部共享包来满足测试。
2. 两个 build job 分别构建 `pixishelf` 与 `pixishelf-worker` 的 `linux/amd64` OCI archive，同时复用/更新 GHCR `:cache`；此时不发布版本、SHA 或 latest 标签。
3. validate 与两个 build 全成功后，publish 下载**本次运行** artifact，校验 SHA-256，以 `skopeo --preserve-digests` 原样发布到 GHCR 与 Docker Hub，不重新构建。
4. 两个发布均成功后，tag 运行创建 Release 并扫描镜像；Release 附带 Compose、环境模板、init.sql 和 DEPLOYMENT 跳转页。
5. `Release timings` 汇总本 attempt 的各 job/step 耗时，包含失败结果；并行耗时不能相加当墙钟总时长。

当前镜像为 `ghcr.io/<owner>/pixishelf`、`ghcr.io/<owner>/pixishelf-worker` 及 Docker Hub 同名镜像，没有 API/Web 双镜像。tag 运行发布版本与 latest，另外包含 SHA 标签；手动运行按 metadata 规则产生标签，不保证更新 latest。当前不构建 arm64。

## 权限与配置

- GHCR 使用内置 `GITHUB_TOKEN` 和 job 的 `packages: write` 权限。
- 当前发布 job **无条件登录 Docker Hub**，需要 `DOCKERHUB_USERNAME` 与 `DOCKERHUB_TOKEN`；文档不能把它描述为已实现的可选发布。
- Release 使用 `contents: write`；安全扫描上传 SARIF 需要 `security-events: write`。
- `APP_VERSION` 是 App 构建参数。工作流仍传 `VITE_API_URL` 遗留 build-arg，但当前 Next.js Dockerfile 未消费它；不要将它当有效 API 配置。
- 生产环境文件和凭据不进入构建上下文或仓库文档；实际运行变量见 `build/.env.example`。

## 重跑与限制

OCI artifact 名包含镜像名和 run ID，保留 3 天、无额外压缩；同次完整重跑覆盖产物，失败 job 重跑可复用该运行中成功的另一份。过期则重跑全部 jobs，不能借用别次运行的镜像。

发布并非跨镜像/跨仓库原子事务：推送失败可能留下部分已更新标签，且不同运行的 latest 更新不保证串行。修复后重跑失败发布并核对两镜像 digest；生产使用明确版本或 digest。扫描在发布之后发生，不是推送前安全门禁。

缓存收益须比较多次成功运行的验证、构建、cache/artifact 传输和发布耗时；不预先承诺固定加速比例。工作流回退不等于生产数据回退，生产仍遵循[备份恢复](../docs/operations/backup-and-recovery.md)。
