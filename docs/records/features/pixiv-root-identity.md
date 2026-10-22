---
status: historical
scope: pixiv-root-identity 的已有验证与发布证据
last-verified: 2026-09-11
sources:
  - docs/features/pixiv-root-identity.md
---

# Pixiv 扫描根身份验证与发布记录

本页从原功能规格提取已有证据，本轮文档整理没有重新运行其中的测试、部署或数据操作。

- 日期：以各段原记录日期为准；未单独注明的段落不推断具体日期。
- 适用版本：以原记录中的版本／提交为准；未记录提交号的结果仅对应当时工作区。
- 验证范围、结论与限制：逐段保留。隔离测试、用户确认和直接生产核验不得互相替代。
- 当前行为：[功能规格](../../features/pixiv-root-identity.md)。恢复前仍须核对当前状态与记录适用条件。

## 扫描根身份验证记录

## 本次验证记录（2026-09-11）

- 独立 PostgreSQL 15 临时容器完成 78 个 migration 的空库部署与 status；隔离 schema 验证空表及旧数据迁移，旧状态和 inventory 保持不变。
- 根身份单测 17 项、扫描 PostgreSQL 回归 59 项、运维命令 PostgreSQL 测试 10 项通过，覆盖新批次导入、各扫描入口、重挂载、UUID 变化时禁止 MISSING、并发和失败恢复。
- Worker 依赖链 typecheck/build、DB validate、完整依赖链测试已执行。Executor 全量测试中 6 项符号链接夹具在 Windows 沙箱报 EPERM，提升权限重跑对应 4 个文件的 41 项测试全部通过。
- 主应用 lint/typecheck/build 通过。单元测试 1,835 项先通过，唯一失败同为符号链接 EPERM；提升权限重跑对应 11 项全部通过。默认跳过的 PostgreSQL 测试不计为通过，本次另行执行来源核对 PostgreSQL 测试 4 项通过。
- 主应用 test:integration 在隔离数据库运行：6 通过、6 失败；在修改前 HEAD `3868fa05` 的独立源码副本复现相同 6 项失败，位于旧 scan/rescan fixture 测试，包含缺失 mock 的 findMany 调用。没有为本次修复改写这些旧测试或断言。
- 编译后的 `dist/pixiv-root-identity.cjs inspect` 已通过只读命令冒烟。未连接生产 NAS 或执行真实飞牛升级；挂载重编号由测试模拟，生产发布后仍须核对首次绑定与新任务结果。
