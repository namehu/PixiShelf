---
status: historical
scope: 后台任务退役旧路径的兼容入口
last-verified: 2026-10-22
sources:
  - docs/operations/runbooks/background-task-retirement.md
  - docs/records/operations/background-task-retirement-2026-10.md
---

# 后台任务退役材料已分流

- 尚未完成退役的实例使用[专用升级手册](../operations/runbooks/background-task-retirement.md)。
- 两阶段开发验证、NAS 用户确认及证据限制见[2026-10 记录](../records/operations/background-task-retirement-2026-10.md)。
- 已完成实例的正常发布使用[部署基线](../operations/deployment.md)。

二阶段删列后不能仅换旧镜像；完整恢复需要同点数据库、三个媒体根、配置与版本。
