---
status: historical
scope: CI 检查与镜像构建发布独立执行的工作流调整
last-verified: 2026-11-04
sources:
  - .github/workflows/build-and-deploy.yml
  - .github/workflows/ci.yml
  - .github/README.md
---

# CI 与镜像发布独立执行

用户明确要求两套工作流各自独立，移除镜像构建中的重复 CI。此次删除 `Build and Deploy` 的 `validate` job，以及发布和耗时汇总对它的依赖；发布只等待本次两个镜像构建成功。独立 CI 的触发方式、检查项和汇总结果保持原样，CI 失败、取消或尚未结束均不阻止镜像发布。

两个镜像仍通过 Dockerfile 执行编译，随后使用本次运行的 OCI artifact，校验 SHA-256 后发布。镜像发布成功后的 Release、安全扫描与耗时汇总继续执行。工作流职责更新在[工作流说明](../../../.github/README.md)，测试覆盖与条件仍由[测试策略](../../development/testing-strategy.md)维护。

本地验证包括 YAML 解析、全部 job 依赖存在且无环、发布只依赖 build、双镜像构建及 artifact 校验保留，以及 Worker 的部署边界测试。没有触发远端工作流、发布镜像或操作应用数据库；恢复方式为恢复本次工作流配置及对应说明，无需恢复业务数据。
