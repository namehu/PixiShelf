---
status: historical
scope: 作品详情标签管理与删除入口的本地验证
last-verified: 2026-11-03
sources:
  - docs/features/artwork-deletion.md
  - docs/features/artwork-tags.md
  - docs/development/testing-strategy.md
---

# 作品详情管理验证记录

2026-11-03 在基线 `a63ca224` 加未提交工作树改动上验证，未部署生产。隔离 PostgreSQL 容器绑定 `127.0.0.1:55439/pixishelf_delete_validation`，应用使用合成管理员、合成作品和 `/private/tmp/pixishelf-detail-validation` 下媒体；未连接真实图库，未启动 Worker。空库部署了已有 137 项迁移；本次功能没有新增 migration。

## 结果

- 隔离 PostgreSQL：`artwork-tags.postgres.test.ts` 4/4，通过来源及派生关联移除、保留未变来源、同名复用和注入故障事务回滚；`artwork-deletion.postgres.test.ts` 4/4，通过临时文件与数据库删除、故障回滚及重试。
- Chrome 合成数据：1360×900 浅色下空标签入口、搜索、键盘选择、保存后详情局部显示通过；取消创建草稿后只读查询确认未创建标签。390×844 浅色下长标签裁切问题修复后复验完整、移除按钮可见；删除预览显示加载反馈并将焦点置于关闭按钮。
- 合成 URL_ARCHIVE 作品 18 在手机视口提交回收请求，预览显示保留 7 天；报告显示请求已提交，关闭报告返回 `/artworks`，列表不再显示该作品。未运行 Worker，未验证物理移动或恢复。
- 普通作品浏览器验证止于永久删除确认前：CUA 的 Computer Use Confirmation Policy 要求不可通过产品正常恢复的删除在动作时确认，即使事先授权也适用。隔离数据库与临时文件集成测试实际执行删除，报告和导航异常分支由组件测试覆盖；不能将其当作浏览器永久删除验收。
- 浅色及深色两种视口截图保存在 `/private/tmp/pixishelf-detail-validation/`，仅含合成数据。深色通过临时为根元素添加 `.dark` 验证，之后已逐字节恢复；标签弹窗与删除预览的文字、危险按钮可辨。隐私模式通过全局开关启用后经列表进入详情：标题、标签、编辑草稿 chip 和删除预览标题均视觉模糊；输入新标签草稿并取消后，隔离库查询未创建该标签。已恢复原关闭偏好。

## 检查与限制

- `pnpm lint`、`pnpm typecheck` 通过。
- 首轮沙箱 `pnpm test`：500 文件通过、55 跳过、3 失败；3753 测试通过、385 跳过、6 失败。5 项因本地 TCP 或 tsx IPC 监听 EPERM，另一项在并行负载下 5 秒超时。三个文件提升权限、降低负载后聚焦复验 39/39 通过；此复验不能替代全量结果。
- 停止开发服务后提升权限顺序运行完整 `pnpm test`：503 文件通过、55 跳过；3759 测试通过、385 跳过。提升权限 `pnpm build` 通过。
- `pnpm docs:check` 检查 382 个 Markdown 通过；Chrome `docs:diagrams:check` 检查 34 图源和 23 内嵌图通过。主应用大写路径检查无结果，`git diff --check` 通过。临时 `.dark` layout 已逐字节恢复并确认 diff 为零；隔离应用和本次数据库容器均已停止。

截图和隔离数据库不包含生产验收证据；未测试真实图库、真实媒体、Worker 回收及恢复、生产部署或生产账号。浏览器永久删除及故障注入的浏览器路径仍未覆盖。
