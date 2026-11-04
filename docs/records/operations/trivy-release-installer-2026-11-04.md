---
status: historical
scope: v0.55.25 发布后 Trivy 安装失败的定位与工作流修复
last-verified: 2026-11-04
sources:
  - .github/workflows/build-and-deploy.yml
  - .github/README.md
---

# Trivy 固定安装来源

`v0.55.25` 对应提交 `75029097`。[CI #335](https://github.com/namehu/PixiShelf/actions/runs/41780608423) 的 Web、Worker、WebP 和汇总全部成功；[Build and Deploy #466](https://github.com/namehu/PixiShelf/actions/runs/41780608438) 的两个镜像构建、两个镜像发布及 Release 创建均成功，唯一失败为[安全扫描 job](https://github.com/namehu/PixiShelf/actions/runs/41780608438/job/126412276421)。失败不撤销已经发布的镜像。

失败日志显示，`aquasecurity/trivy-action@master` 解析为 `8f28faec26515256b6d22074d1d2a8986f4cbd87`，默认安装 Trivy v0.76.1。安装脚本在找到版本后退出 6，扫描本身尚未启动。核对该次引用的[上游安装脚本](https://github.com/aquasecurity/trivy/blob/75c4dc0f45c5d7ffd05ae26df1e0c666787bdf2a/contrib/install.sh)，此时首先通过 curl 从 `get.trivy.dev` 下载安装包；退出 6 对应主机名解析失败。日志不能证明镜像存在漏洞，也不能据此判定代码构建失败。

修复在扫描 job 中从官方 GitHub Release 直接下载相同的 Trivy 0.76.1 Linux x64 安装包，按该 Release asset 公布的 SHA-256 校验，再解压到 runner 临时目录。两个扫描步骤复用这份二进制，设置 `skip-setup-trivy`；Action 固定为 v0.36.0 对应提交 `ed142fd0673e97e23eac54620cfb913e5ce36c25`，避免浮动 master 改变安装行为。镜像扫描和 SARIF 上传继续执行。

本地从实际工作流提取安装脚本，在临时 Linux amd64 / Alpine 3.22 容器中执行真实下载、SHA-256 检查和解压，`trivy --version` 返回 `0.76.1`；容器执行成功后自动删除。Worker 部署边界 20 项测试通过。验证不包含本地完整漏洞扫描或新的远端 workflow run，原发布记录继续保留那次安装失败的结果。

本次只调整扫描工具的安装来源，无应用数据库、媒体或部署配置变更；恢复方式为恢复工作流与对应说明。
